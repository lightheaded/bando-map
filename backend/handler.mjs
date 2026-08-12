/**
 * bando-map API: per-user sync + community submissions + admin review.
 *
 *   GET  /sync                    -> { data: UserData, updatedAt }  (404 until the first push)
 *   PUT  /sync                    <- UserData                       -> { updatedAt }
 *   GET  /submissions             -> { submissions }                (caller's own, newest first)
 *   POST /submissions             <- SubmissionData                 -> { submission }
 *   POST /photos                  <- { targetId, name, full, thumb, … } -> { submission }
 *   GET  /photos/{id}             -> { full, thumb, contentType }   (owner or admin)
 *   GET  /admin/overview          -> { submissions, users, visits }  (admin)
 *   POST /admin/submissions/{id}  <- { action, reason? }            -> { submission } (admin)
 *
 * The API Gateway JWT authorizer validates the Cognito ID token before this
 * code runs; admin routes additionally require the token to carry the
 * ADMIN_GROUP Cognito group. Approving a submission rebuilds data/community.json from all
 * approved submissions and publishes it to the site bucket + invalidates the
 * CloudFront path, so decisions reach every client without a rescrape. A
 * submission adds a place, corrects one, deletes one, or adds a photo of one —
 * an approved deletion lands in the file's `deleted` list and every client drops
 * that id.
 *
 * Photos arrive already resized and re-encoded by the browser
 * (src/photos/prepare.ts), which is what keeps this Lambda out of the business
 * of decoding hostile pixels: it sniffs the container header for the format and
 * dimensions, then moves bytes. Uploads land in PHOTO_BUCKET under
 * pending/<submission id>/, private and unreachable from the CDN, and only an
 * approval copies them into the site bucket under data/photos/.
 *
 * Storage: the sync table doubles as the submission store and the visit-stats
 * store — sync documents live at pk=<cognito sub>, submissions at pk=sub#<uuid>,
 * one day of visit counts at pk=stat#<YYYY-MM-DD> (written by the rollup Lambda,
 * backend/rollup.mjs). Listing scans; at this scale (a handful of users, few
 * hundred submissions, a few months of days) that beats a GSI.
 */
import { randomUUID } from 'node:crypto'
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb'
import { S3Client, PutObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider'

const db = new DynamoDBClient({})
const s3 = new S3Client({})
const cloudfront = new CloudFrontClient({})
const cognito = new CognitoIdentityProviderClient({})

const TABLE = process.env.TABLE_NAME
const ADMIN_GROUP = process.env.ADMIN_GROUP ?? 'admin'
const SITE_BUCKET = process.env.SITE_BUCKET
const PHOTO_BUCKET = process.env.PHOTO_BUCKET
const DISTRIBUTION_ID = process.env.DISTRIBUTION_ID
const USER_POOL_ID = process.env.USER_POOL_ID

// DynamoDB items cap at 400 KB; leave headroom for the key and metadata.
const MAX_SYNC_BYTES = 350_000
const MAX_SUBMISSION_BYTES = 8_000
// A photo upload carries both renders base64-encoded, so ~1.33x their bytes.
const MAX_PHOTO_UPLOAD_BYTES = 900_000
const MAX_FULL_BYTES = 500_000
const MAX_THUMB_BYTES = 100_000
/**
 * What a browser-prepared render should look like. The lower bound on width is
 * there so a 1x1 pixel can't take a queue slot; the upper bounds cap what a
 * reviewer's browser is asked to decode.
 */
const PHOTO_DIMS = { minWidth: 200, maxWidth: 4_096, maxHeight: 4_096, maxThumbWidth: 640 }
// Per-user upload limits. Storage and processing are nearly free (see README
// "Cost"); the scarce resource is the reviewer's attention, so cap the queue.
const PHOTOS_PER_DAY = 20
const MAX_PENDING_PHOTOS = 30
// How many days of visit stats the admin overview carries.
const VISIT_DAYS = 90
// Loose Estonia bounding box — sanity check for submitted coordinates.
const BOUNDS = { latMin: 57.0, latMax: 60.5, lonMin: 20.5, lonMax: 29.0 }
const OVERRIDE_FIELDS = ['lat', 'lon', 'name', 'address', 'period', 'usage', 'condition']

const res = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const rawBody = (event) =>
  event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString() : (event.body ?? '')

// ---------- submissions ----------

const toSubmission = (item) => ({
  id: item.pk.S.slice(4),
  email: item.email.S,
  status: item.status.S,
  createdAt: item.createdAt.S,
  decidedAt: item.decidedAt?.S,
  reason: item.reason?.S,
  data: JSON.parse(item.data.S),
})

/**
 * All submission items (pk=sub#...), following scan pagination. Optional
 * narrowing by owner or status ('owner' and 'status' are DynamoDB reserved
 * words, hence the attribute-name placeholders).
 */
async function allSubmissions(filter) {
  const items = []
  let key
  do {
    const out = await db.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: `begins_with(pk, :prefix)${filter ? ' AND #f = :value' : ''}`,
        ExpressionAttributeValues: { ':prefix': { S: 'sub#' }, ...(filter ? { ':value': { S: filter.value } } : {}) },
        ...(filter ? { ExpressionAttributeNames: { '#f': filter.attr } } : {}),
        ExclusiveStartKey: key,
      }),
    )
    items.push(...(out.Items ?? []))
    key = out.LastEvaluatedKey
  } while (key)
  return items.map(toSubmission).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

/** null when valid, else a human-readable problem. */
function validateSubmission(data) {
  if (typeof data !== 'object' || data === null) return 'not an object'
  if (!['edit', 'place', 'delete'].includes(data.type)) return 'unknown type'
  if (!Number.isFinite(data.targetId)) return 'bad targetId'
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 250) return 'bad name'
  if (data.note != null && (typeof data.note !== 'string' || data.note.length > 1000)) return 'bad note'
  const after = data.after
  // A deletion proposes no values — only a reason, which the reviewer judges it by.
  if (data.type === 'delete') {
    if (after != null && (typeof after !== 'object' || Object.keys(after).length)) return 'a deletion proposes no values'
    if (typeof data.note !== 'string' || !data.note.trim()) return 'a deletion needs a reason'
    return null
  }
  if (typeof after !== 'object' || after === null || !Object.keys(after).length) return 'empty change'
  for (const [key, value] of Object.entries(after)) {
    if (!OVERRIDE_FIELDS.includes(key)) return `unknown field ${key}`
    if (key === 'lat' || key === 'lon') {
      if (typeof value !== 'number') return `bad ${key}`
    } else if (typeof value !== 'string' || value.length > 300) {
      return `bad ${key}`
    }
  }
  const { lat, lon } = after
  if ((lat == null) !== (lon == null)) return 'lat and lon must come together'
  if (lat != null && (lat < BOUNDS.latMin || lat > BOUNDS.latMax || lon < BOUNDS.lonMin || lon > BOUNDS.lonMax))
    return 'coordinates outside Estonia'
  if (data.type === 'place' && (lat == null || !after.name?.trim())) return 'a place needs name and coordinates'
  return null
}

async function createSubmission(claims, event) {
  const raw = rawBody(event)
  if (raw.length > MAX_SUBMISSION_BYTES) return res(413, { error: `payload exceeds ${MAX_SUBMISSION_BYTES} bytes` })
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return res(400, { error: 'invalid JSON' })
  }
  const problem = validateSubmission(data)
  if (problem) return res(400, { error: problem })

  // Resubmitting the same place replaces the still-pending submission instead
  // of piling up duplicates in the review queue. Photos are exempt: they add to
  // a place rather than restate it, so a correction must not swallow a photo of
  // the same building that is still waiting for review (nor the reverse — every
  // photo gets its own id in createPhoto).
  const mine = await allSubmissions({ attr: 'owner', value: claims.sub })
  const pending = mine.find(
    (s) => s.status === 'pending' && s.data.type !== 'photo' && s.data.targetId === data.targetId,
  )
  const id = pending?.id ?? randomUUID()
  const submission = {
    id,
    email: claims.email,
    status: 'pending',
    createdAt: new Date().toISOString(),
    data,
  }
  await db.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: {
        pk: { S: `sub#${id}` },
        owner: { S: claims.sub },
        email: { S: claims.email ?? '' },
        status: { S: 'pending' },
        createdAt: { S: submission.createdAt },
        data: { S: JSON.stringify(data) },
      },
    }),
  )
  return res(200, { submission })
}

// ---------- photos ----------

/**
 * Width, height and format read straight out of the container header. This is
 * the whole of our image inspection: no decoder runs here, so a malformed file
 * is a `undefined` return rather than a memory-safety problem. Anything we
 * can't parse is refused — the browser only ever sends these two formats.
 */
function imageSize(buf) {
  if (buf.length > 16 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return webpSize(buf)
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return jpegSize(buf)
  return undefined
}

/** The three still-image webp flavours keep their canvas size in different places. */
function webpSize(buf) {
  const chunk = buf.toString('ascii', 12, 16)
  // Extended (what a canvas emits for an image with alpha): 24-bit canvas size.
  if (chunk === 'VP8X' && buf.length >= 30)
    return { ext: 'webp', w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 }
  // Simple lossy: 3-byte frame tag, the 0x9d012a keyframe sync code, then 14-bit
  // width and height with the scale factor in the top two bits.
  if (chunk === 'VP8 ' && buf.length >= 30 && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a)
    return { ext: 'webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
  // Simple lossless: signature byte, then two 14-bit fields holding size - 1.
  if (chunk === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
    const bits = buf.readUInt32LE(21)
    return { ext: 'webp', w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 }
  }
  return undefined
}

/** First SOFn frame header wins — JPEG stores the size there, big-endian. */
function jpegSize(buf) {
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return undefined
    const marker = buf[i + 1]
    // SOF0..SOF15, minus the three markers in that range that aren't frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { ext: 'jpg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return undefined
}

/** The decoded renders, or a human-readable problem. */
function checkRenders(body) {
  if (typeof body.full !== 'string' || typeof body.thumb !== 'string') return { error: 'missing renders' }
  const full = Buffer.from(body.full, 'base64')
  const thumb = Buffer.from(body.thumb, 'base64')
  if (!full.length || !thumb.length) return { error: 'empty render' }
  if (full.length > MAX_FULL_BYTES) return { error: `full render exceeds ${MAX_FULL_BYTES} bytes` }
  if (thumb.length > MAX_THUMB_BYTES) return { error: `thumbnail exceeds ${MAX_THUMB_BYTES} bytes` }
  const fullSize = imageSize(full)
  const thumbSize = imageSize(thumb)
  if (!fullSize || !thumbSize) return { error: 'not a webp or jpeg image' }
  if (fullSize.ext !== thumbSize.ext) return { error: 'renders disagree on format' }
  if (fullSize.w < PHOTO_DIMS.minWidth) return { error: `narrower than ${PHOTO_DIMS.minWidth}px` }
  if (fullSize.w > PHOTO_DIMS.maxWidth || fullSize.h > PHOTO_DIMS.maxHeight) return { error: 'too many pixels' }
  if (thumbSize.w > PHOTO_DIMS.maxThumbWidth) return { error: 'thumbnail is not a thumbnail' }
  return { full, thumb, ext: fullSize.ext, w: fullSize.w, h: fullSize.h }
}

const photoKey = (id, ext, variant) => `pending/${id}/${variant}.${ext}`
const CONTENT_TYPE = { webp: 'image/webp', jpg: 'image/jpeg' }

/**
 * Accept an uploaded photo: check it, park both renders in the private review
 * bucket, and queue a submission. Nothing is visible to anyone but the
 * contributor and a reviewer until an approval publishes it.
 */
async function createPhoto(claims, event) {
  const raw = rawBody(event)
  if (raw.length > MAX_PHOTO_UPLOAD_BYTES) return res(413, { error: `payload exceeds ${MAX_PHOTO_UPLOAD_BYTES} bytes` })
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return res(400, { error: 'invalid JSON' })
  }
  if (!Number.isFinite(body?.targetId)) return res(400, { error: 'bad targetId' })
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 250) return res(400, { error: 'bad name' })
  if (body.own !== true) return res(400, { error: 'the photo must be declared your own work' })
  if (body.credit != null && (typeof body.credit !== 'string' || body.credit.length > 120))
    return res(400, { error: 'bad credit' })
  if (body.note != null && (typeof body.note !== 'string' || body.note.length > 1000)) return res(400, { error: 'bad note' })
  const checked = checkRenders(body)
  if (checked.error) return res(400, { error: checked.error })

  // Two ceilings, both per contributor: how much can be waiting for review at
  // once, and how much can arrive in a day.
  const mine = await allSubmissions({ attr: 'owner', value: claims.sub })
  const photos = mine.filter((s) => s.data.type === 'photo')
  if (photos.filter((s) => s.status === 'pending').length >= MAX_PENDING_PHOTOS)
    return res(429, { error: `${MAX_PENDING_PHOTOS} of your photos are already waiting for review` })
  const today = new Date().toISOString().slice(0, 10)
  if (photos.filter((s) => s.createdAt.startsWith(today)).length >= PHOTOS_PER_DAY)
    return res(429, { error: `${PHOTOS_PER_DAY} photos a day is the limit — try again tomorrow` })

  const id = randomUUID()
  const { ext } = checked
  await Promise.all(
    [
      ['full', checked.full],
      ['thumb', checked.thumb],
    ].map(([variant, bytes]) =>
      s3.send(
        new PutObjectCommand({
          Bucket: PHOTO_BUCKET,
          Key: photoKey(id, ext, variant),
          Body: bytes,
          ContentType: CONTENT_TYPE[ext],
        }),
      ),
    ),
  )

  const data = {
    type: 'photo',
    targetId: body.targetId,
    name: body.name,
    after: {},
    note: body.note?.trim() || undefined,
    photo: {
      file: `${id}.${ext}`,
      w: checked.w,
      h: checked.h,
      bytes: checked.full.length,
      own: true,
      credit: body.credit?.trim() || undefined,
    },
  }
  const createdAt = new Date().toISOString()
  await db.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: {
        pk: { S: `sub#${id}` },
        owner: { S: claims.sub },
        email: { S: claims.email ?? '' },
        status: { S: 'pending' },
        createdAt: { S: createdAt },
        data: { S: JSON.stringify(data) },
      },
    }),
  )
  return res(200, { submission: { id, email: claims.email, status: 'pending', createdAt, data } })
}

/**
 * The stored renders of one photo submission, base64, for the reviewer's queue
 * and for the contributor watching their own upload. Pending images are not on
 * the CDN, so this route is the only way to see them — hence the ownership check.
 */
async function getPhoto(claims, event) {
  const id = event.pathParameters?.id
  if (!id) return res(400, { error: 'no id' })
  const out = await db.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: `sub#${id}` } } }))
  if (!out.Item) return res(404, { error: 'no such submission' })
  const data = JSON.parse(out.Item.data.S)
  if (data.type !== 'photo') return res(404, { error: 'not a photo submission' })
  if (out.Item.owner?.S !== claims.sub && !groups(claims).includes(ADMIN_GROUP)) return res(403, { error: 'not yours' })

  const ext = data.photo.file.split('.').pop()
  const read = async (variant) => {
    const object = await s3.send(new GetObjectCommand({ Bucket: PHOTO_BUCKET, Key: photoKey(id, ext, variant) }))
    return Buffer.from(await object.Body.transformToByteArray()).toString('base64')
  }
  try {
    const [full, thumb] = await Promise.all([read('full'), read('thumb')])
    return res(200, { full, thumb, contentType: CONTENT_TYPE[ext] })
  } catch {
    // The review copies expire eventually (see the bucket's lifecycle rule); an
    // approved photo is on the CDN by then, a rejected one is meant to be gone.
    return res(410, { error: 'the uploaded copy is no longer stored' })
  }
}

/** Copy an approved photo's renders to the site bucket, where CloudFront serves them. */
async function publishPhoto(id, photo) {
  const ext = photo.file.split('.').pop()
  const thumbFile = photo.file.replace(/(\.\w+)$/, '-t$1')
  await Promise.all(
    [
      ['full', photo.file],
      ['thumb', thumbFile],
    ].map(([variant, name]) =>
      s3.send(
        new CopyObjectCommand({
          Bucket: SITE_BUCKET,
          Key: `data/photos/${name}`,
          CopySource: `${PHOTO_BUCKET}/${photoKey(id, ext, variant)}`,
          // A published photo never changes under its name, so it can be cached
          // forever — REPLACE because the copy would otherwise inherit no
          // Cache-Control at all.
          MetadataDirective: 'REPLACE',
          ContentType: CONTENT_TYPE[ext],
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      ),
    ),
  )
}

/** Take a photo back off the CDN when its approval is undone. */
async function unpublishPhoto(photo) {
  const thumbFile = photo.file.replace(/(\.\w+)$/, '-t$1')
  await Promise.all(
    [photo.file, thumbFile].map((name) =>
      s3.send(new DeleteObjectCommand({ Bucket: SITE_BUCKET, Key: `data/photos/${name}` })),
    ),
  )
}

// ---------- community.json publishing ----------

/**
 * Rebuild data/community.json from every approved submission (oldest decision
 * first, so a later approval on the same target wins) and publish it.
 */
async function republishCommunity() {
  const approved = (await allSubmissions({ attr: 'status', value: 'approved' })).sort((a, b) =>
    (a.decidedAt ?? '') < (b.decidedAt ?? '') ? -1 : 1,
  )
  const overrides = {}
  const places = new Map()
  const deleted = new Set()
  const photos = {}
  for (const s of approved) {
    const id = s.data.targetId
    if (s.data.type === 'delete') {
      // Off the map, and its accumulated corrections go with it.
      deleted.add(id)
      places.delete(id)
      delete overrides[id]
      delete photos[id]
      continue
    }
    // A photo says something about the building, not about whether the place
    // belongs on the map — so unlike the other types it never undeletes one.
    if (s.data.type === 'photo') {
      ;(photos[id] ??= []).push(s.data.photo.file)
      continue
    }
    // Approving anything else on the same target puts it back — decisions
    // apply in the order they were made, latest wins.
    deleted.delete(id)
    if (s.data.type === 'place') {
      const { name, lat, lon } = s.data.after
      places.set(id, { id, name, lat, lon })
    } else {
      overrides[id] = { ...overrides[id], ...s.data.after }
    }
  }
  // A photo approved before its place was removed would otherwise linger here.
  for (const id of deleted) delete photos[id]
  const body = JSON.stringify({
    version: 1,
    publishedAt: new Date().toISOString(),
    overrides,
    places: [...places.values()],
    deleted: [...deleted],
    photos,
  })
  await s3.send(
    new PutObjectCommand({
      Bucket: SITE_BUCKET,
      Key: 'data/community.json',
      Body: body,
      ContentType: 'application/json',
      CacheControl: 'public, max-age=60',
    }),
  )
  await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: DISTRIBUTION_ID,
      InvalidationBatch: {
        CallerReference: `community-${Date.now()}`,
        Paths: { Quantity: 1, Items: ['/data/community.json'] },
      },
    }),
  )
}

// ---------- admin ----------

async function decideSubmission(claims, event) {
  const id = event.pathParameters?.id
  let body
  try {
    body = JSON.parse(rawBody(event) || '{}')
  } catch {
    return res(400, { error: 'invalid JSON' })
  }
  const action = { approve: 'approved', reject: 'rejected', reopen: 'pending' }[body.action]
  const reason = body.reason
  if (!id || !action) return res(400, { error: 'unknown action' })
  if (action === 'rejected' && (typeof reason !== 'string' || !reason.trim()))
    return res(400, { error: 'rejecting requires a reason' })
  if (reason != null && (typeof reason !== 'string' || reason.length > 500)) return res(400, { error: 'bad reason' })

  const existing = await db.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: `sub#${id}` } } }))
  if (!existing.Item) return res(404, { error: 'no such submission' })
  const previous = existing.Item.status.S
  const existingData = JSON.parse(existing.Item.data.S)

  const decided = action !== 'pending'
  await db.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: { pk: { S: `sub#${id}` } },
      UpdateExpression: decided
        ? `SET #s = :status, decidedAt = :at${action === 'rejected' ? ', #r = :reason' : ' REMOVE #r'}`
        : 'SET #s = :status REMOVE decidedAt, #r',
      ExpressionAttributeNames: { '#s': 'status', '#r': 'reason' },
      ExpressionAttributeValues: {
        ':status': { S: action },
        ...(decided ? { ':at': { S: new Date().toISOString() } } : {}),
        ...(action === 'rejected' ? { ':reason': { S: reason.trim() } } : {}),
      },
    }),
  )
  // A photo's bytes move with its verdict: onto the CDN on approval, off it
  // again if that approval is withdrawn. The private review copy stays either
  // way, until its lifecycle rule expires it.
  if (existingData.type === 'photo') {
    if (action === 'approved') await publishPhoto(id, existingData.photo)
    else if (previous === 'approved') await unpublishPhoto(existingData.photo)
  }
  // Anything entering or leaving the approved set changes the published file.
  if (action === 'approved' || previous === 'approved') await republishCommunity()
  const updated = await db.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: `sub#${id}` } } }))
  return res(200, { submission: toSubmission(updated.Item) })
}

async function adminOverview() {
  const [submissions, users, syncDocs, visits] = await Promise.all([
    allSubmissions(),
    listUsers(),
    listSyncTimestamps(),
    listVisits(),
  ])
  return res(200, {
    submissions,
    users: users.map((u) => ({ ...u, lastSyncAt: syncDocs.get(u.sub), sub: undefined })),
    visits,
  })
}

/**
 * Daily visit counts (pk=stat#<date>), newest first. Aggregates only — the
 * rollup never stores a viewer IP, just how many distinct ones it saw.
 */
async function listVisits() {
  const days = []
  let key
  do {
    const out = await db.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'begins_with(pk, :prefix)',
        ExpressionAttributeValues: { ':prefix': { S: 'stat#' } },
        ProjectionExpression: 'pk, #d, updatedAt',
        ExpressionAttributeNames: { '#d': 'data' },
        ExclusiveStartKey: key,
      }),
    )
    for (const item of out.Items ?? []) {
      days.push({ date: item.pk.S.slice(5), updatedAt: item.updatedAt?.S, ...JSON.parse(item.data.S) })
    }
    key = out.LastEvaluatedKey
  } while (key)
  return days.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, VISIT_DAYS)
}

async function listUsers() {
  const users = []
  let token
  do {
    const out = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, PaginationToken: token }))
    for (const u of out.Users ?? []) {
      const attr = (name) => u.Attributes?.find((a) => a.Name === name)?.Value
      users.push({ sub: attr('sub'), email: attr('email'), createdAt: u.UserCreateDate?.toISOString() })
    }
    token = out.PaginationToken
  } while (token)
  return users
}

/** sub -> last sync time, from the sync documents' updatedAt. */
async function listSyncTimestamps() {
  const map = new Map()
  let key
  do {
    const out = await db.send(
      new ScanCommand({
        TableName: TABLE,
        // Everything that isn't a submission or a stats rollup is a sync doc.
        FilterExpression: 'NOT begins_with(pk, :prefix) AND NOT begins_with(pk, :stat)',
        ExpressionAttributeValues: { ':prefix': { S: 'sub#' }, ':stat': { S: 'stat#' } },
        ProjectionExpression: 'pk, updatedAt',
        ExclusiveStartKey: key,
      }),
    )
    for (const item of out.Items ?? []) map.set(item.pk.S, item.updatedAt?.S)
    key = out.LastEvaluatedKey
  } while (key)
  return map
}

// ---------- sync (unchanged) ----------

async function getSync(claims) {
  const out = await db.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: claims.sub } } }))
  if (!out.Item) return res(404, { error: 'no data yet' })
  return res(200, { data: JSON.parse(out.Item.data.S), updatedAt: out.Item.updatedAt.S })
}

async function putSync(claims, event) {
  const raw = rawBody(event)
  if (raw.length > MAX_SYNC_BYTES) return res(413, { error: `payload exceeds ${MAX_SYNC_BYTES} bytes` })
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return res(400, { error: 'invalid JSON' })
  }
  if (data?.version !== 1 || typeof data.marks !== 'object' || data.marks === null) {
    return res(400, { error: 'unrecognized export format' })
  }
  const updatedAt = new Date().toISOString()
  await db.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: { pk: { S: claims.sub }, data: { S: JSON.stringify(data) }, updatedAt: { S: updatedAt } },
    }),
  )
  return res(200, { updatedAt })
}

// ---------- router ----------

/**
 * Cognito group names from the JWT claims. The HTTP API authorizer flattens
 * multi-value claims to a bracketed string (`"[admin, other]"`) rather than an
 * array, so accept both shapes.
 */
function groups(claims) {
  const raw = claims['cognito:groups']
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  return raw.replace(/^\[|\]$/g, '').split(/,\s*/).filter(Boolean)
}

export const handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims
  if (!claims?.sub) return res(401, { error: 'unauthenticated' })

  const route = event.routeKey ?? `${event.requestContext?.http?.method} ${event.rawPath}`
  if (route.includes('/admin/') && !groups(claims).includes(ADMIN_GROUP)) {
    return res(403, { error: 'admin only' })
  }

  switch (route) {
    case 'GET /sync':
      return getSync(claims)
    case 'PUT /sync':
      return putSync(claims, event)
    case 'GET /submissions':
      return res(200, { submissions: await allSubmissions({ attr: 'owner', value: claims.sub }) })
    case 'POST /submissions':
      return createSubmission(claims, event)
    case 'POST /photos':
      return createPhoto(claims, event)
    case 'GET /photos/{id}':
      return getPhoto(claims, event)
    case 'GET /admin/overview':
      return adminOverview()
    case 'POST /admin/submissions/{id}':
      return decideSubmission(claims, event)
    default:
      return res(405, { error: 'method not allowed' })
  }
}

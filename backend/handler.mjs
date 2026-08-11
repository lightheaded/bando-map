/**
 * bando-map API: per-user sync + community submissions + admin review.
 *
 *   GET  /sync                    -> { data: UserData, updatedAt }  (404 until the first push)
 *   PUT  /sync                    <- UserData                       -> { updatedAt }
 *   GET  /submissions             -> { submissions }                (caller's own, newest first)
 *   POST /submissions             <- SubmissionData                 -> { submission }
 *   GET  /admin/overview          -> { submissions, users }         (admin)
 *   POST /admin/submissions/{id}  <- { action, reason? }            -> { submission } (admin)
 *
 * The API Gateway JWT authorizer validates the Cognito ID token before this
 * code runs; admin routes additionally require the token's email to be in
 * ADMIN_EMAILS. Approving a submission rebuilds data/community.json from all
 * approved submissions and publishes it to the site bucket + invalidates the
 * CloudFront path, so decisions reach every client without a rescrape.
 *
 * Storage: the sync table doubles as the submission store — sync documents
 * live at pk=<cognito sub>, submissions at pk=sub#<uuid>. Listing scans; at
 * this scale (a handful of users, few hundred submissions) that beats a GSI.
 */
import { randomUUID } from 'node:crypto'
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider'

const db = new DynamoDBClient({})
const s3 = new S3Client({})
const cloudfront = new CloudFrontClient({})
const cognito = new CognitoIdentityProviderClient({})

const TABLE = process.env.TABLE_NAME
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '').split(',').filter(Boolean)
const SITE_BUCKET = process.env.SITE_BUCKET
const DISTRIBUTION_ID = process.env.DISTRIBUTION_ID
const USER_POOL_ID = process.env.USER_POOL_ID

// DynamoDB items cap at 400 KB; leave headroom for the key and metadata.
const MAX_SYNC_BYTES = 350_000
const MAX_SUBMISSION_BYTES = 8_000
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
  if (data.type !== 'edit' && data.type !== 'place') return 'unknown type'
  if (!Number.isFinite(data.targetId)) return 'bad targetId'
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 250) return 'bad name'
  if (data.note != null && (typeof data.note !== 'string' || data.note.length > 1000)) return 'bad note'
  const after = data.after
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
  // of piling up duplicates in the review queue.
  const mine = await allSubmissions({ attr: 'owner', value: claims.sub })
  const pending = mine.find((s) => s.status === 'pending' && s.data.targetId === data.targetId)
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
  for (const s of approved) {
    if (s.data.type === 'place') {
      const { name, lat, lon } = s.data.after
      places.set(s.data.targetId, { id: s.data.targetId, name, lat, lon })
    } else {
      overrides[s.data.targetId] = { ...overrides[s.data.targetId], ...s.data.after }
    }
  }
  const body = JSON.stringify({
    version: 1,
    publishedAt: new Date().toISOString(),
    overrides,
    places: [...places.values()],
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
  // Anything entering or leaving the approved set changes the published file.
  if (action === 'approved' || previous === 'approved') await republishCommunity()
  const updated = await db.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: `sub#${id}` } } }))
  return res(200, { submission: toSubmission(updated.Item) })
}

async function adminOverview() {
  const [submissions, users, syncDocs] = await Promise.all([
    allSubmissions(),
    listUsers(),
    listSyncTimestamps(),
  ])
  return res(200, {
    submissions,
    users: users.map((u) => ({ ...u, lastSyncAt: syncDocs.get(u.sub), sub: undefined })),
  })
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
        FilterExpression: 'NOT begins_with(pk, :prefix)',
        ExpressionAttributeValues: { ':prefix': { S: 'sub#' } },
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

export const handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims
  if (!claims?.sub) return res(401, { error: 'unauthenticated' })

  const route = event.routeKey ?? `${event.requestContext?.http?.method} ${event.rawPath}`
  if (route.includes('/admin/') && !ADMIN_EMAILS.includes(claims.email)) {
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
    case 'GET /admin/overview':
      return adminOverview()
    case 'POST /admin/submissions/{id}':
      return decideSubmission(claims, event)
    default:
      return res(405, { error: 'method not allowed' })
  }
}

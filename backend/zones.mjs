/**
 * UAS geographical zones fetcher — keeps data/zones.json on the site current.
 *
 * Two triggers, one job:
 *   EventBridge schedule      -> refresh unconditionally
 *   POST /zones/refresh (API) -> refresh if the caller is inside both throttles
 *
 * Source: https://utm.eans.ee/avm/utm/uas.geojson, the feed behind Estonia's
 * official drone map (utm.eans.ee/avm). It is public and unauthenticated but
 * undocumented, uncompressed (5.1 MB on the wire) and served
 * `Cache-Control: private, max-age=1` — so it is unfit to hit from the browser.
 * This Lambda pays that cost once per schedule tick, trims it to about a fifth,
 * and parks the result on our own CDN where it compresses and caches.
 *
 * The trim drops `properties.geometry.horizontalProjection` (a byte-for-byte
 * duplicate of the feature's own geometry, roughly half the payload) and rounds
 * coordinates to 6 decimals (~11 cm — far past what an airspace boundary means).
 *
 * The output is a GeoJSON FeatureCollection with extra top-level keys, so the
 * app can hand it straight to MapLibre while still reading `checkedAt`.
 * MapLibre ignores keys it does not know.
 *
 * Interpretation stays on the client (src/map/zones.ts): this writes the
 * source's own fields through, it does not decide what counts as restrictive.
 */
import { createHash, createHmac } from 'node:crypto'

/**
 * The AWS clients load on first use rather than at module scope. The SDK ships
 * in the Lambda runtime but not in this repo's node_modules, and keeping the
 * import out of the module's top level lets local tooling and tests import the
 * pure parts of this file — `trimFeature` above all — without it. Lambda keeps
 * the resolved module for the life of the container, so this costs one await
 * on a cold start and nothing after.
 */
let clients
async function aws() {
  if (!clients) {
    const [dynamo, s3mod, cf] = await Promise.all([
      import('@aws-sdk/client-dynamodb'),
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/client-cloudfront'),
    ])
    clients = {
      db: new dynamo.DynamoDBClient({}),
      s3: new s3mod.S3Client({}),
      cloudfront: new cf.CloudFrontClient({}),
      GetItemCommand: dynamo.GetItemCommand,
      PutItemCommand: dynamo.PutItemCommand,
      UpdateItemCommand: dynamo.UpdateItemCommand,
      PutObjectCommand: s3mod.PutObjectCommand,
      CreateInvalidationCommand: cf.CreateInvalidationCommand,
    }
  }
  return clients
}

const TABLE = process.env.TABLE_NAME
const SITE_BUCKET = process.env.SITE_BUCKET
const DISTRIBUTION_ID = process.env.DISTRIBUTION_ID
const SOURCE_URL = process.env.SOURCE_URL ?? 'https://utm.eans.ee/avm/utm/uas.geojson'
const KEY = 'data/zones.json'

/** Manual-refresh throttles. Generous enough to never bite a real pilot. */
const PER_CLIENT_DAILY = Number(process.env.PER_CLIENT_DAILY ?? 3)
const GLOBAL_HOURLY = Number(process.env.GLOBAL_HOURLY ?? 10)
/** Salts the client hash so the table never holds anything IP-derived that outlives it. */
const IP_SALT = process.env.IP_SALT ?? 'unsalted'

const META_PK = 'zones#meta'
// The source is polled far more often than it changes; 25 s is well clear of a
// normal 1-2 s response and still leaves room under the Lambda timeout.
const FETCH_TIMEOUT_MS = 25_000

const ATTRIBUTION =
  'UAS zones: <a href="https://utm.eans.ee/avm/" target="_blank" rel="noopener">EANS Estonian Drone Map</a>'

const res = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

// ---------- trim ----------

const round6 = (n) => Math.round(n * 1e6) / 1e6

/**
 * One source feature -> one slim feature. Everything an FPV pilot needs to
 * judge the zone is kept: the vertical band and its reference, whether the
 * entry is permanent, and both language versions of the message — the message
 * is where a "NO_RESTRICTION" nature zone admits it actually needs a written
 * permit, so dropping it would misrepresent the zone.
 */
export function trimFeature(f) {
  const p = f.properties ?? {}
  const g = p.geometry ?? {}
  const applicability = Array.isArray(p.applicability) ? (p.applicability[0] ?? {}) : {}
  const localized = p.extendedProperties?.localizedMessages ?? []
  const byLang = (lang) => localized.find((m) => m.language === lang)?.message
  const permanent = applicability.permanent !== 'NO'
  return {
    type: 'Feature',
    geometry: {
      type: f.geometry.type,
      coordinates: f.geometry.coordinates.map((ring) => ring.map(([x, y]) => [round6(x), round6(y)])),
    },
    properties: {
      id: p.identifier,
      name: p.name,
      restriction: p.restriction,
      reason: p.reason,
      lower: p.lowerMeters ?? 0,
      upper: p.upperMeters ?? 0,
      lowerRef: g.lowerVerticalReference ?? 'AGL',
      upperRef: g.upperVerticalReference ?? 'AGL',
      permanent,
      ...(permanent ? {} : { start: applicability.startDateTime, end: applicability.endDateTime }),
      message: byLang('en-GB') ?? p.message ?? undefined,
      messageEt: byLang('et-EE') ?? undefined,
      // Free-text extra conditions; empty string on most entries.
      conditions: p.restrictionConditions || undefined,
    },
  }
}

async function fetchSource() {
  const started = Date.now()
  const response = await fetch(SOURCE_URL, {
    headers: { 'user-agent': 'bando-map (+https://bando.lagle.xyz)', accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`source HTTP ${response.status}`)
  const raw = await response.json()
  if (raw?.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
    throw new Error('source is not a FeatureCollection')
  }
  // `hidden` entries are ones the official app itself does not draw.
  const features = raw.features
    .filter((f) => f?.geometry?.coordinates && !f.properties?.hidden)
    .map(trimFeature)
  if (!features.length) throw new Error('source returned no drawable zones')
  console.log(`fetched ${raw.features.length} zones, kept ${features.length}, in ${Date.now() - started} ms`)
  return features
}

// ---------- publish ----------

async function readMeta() {
  const { db, GetItemCommand } = await aws()
  const out = await db.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: META_PK } } }))
  return out.Item ? { hash: out.Item.hash?.S, fetchedAt: out.Item.fetchedAt?.S } : {}
}

/**
 * Fetch, trim, publish. The file is rewritten on every run so `checkedAt` stays
 * honest about when we last looked, but the CDN is only invalidated when the
 * zones themselves changed — invalidation paths are a metered resource and the
 * source usually returns exactly what it returned an hour ago.
 */
async function refresh() {
  const { db, s3, cloudfront, PutItemCommand, PutObjectCommand, CreateInvalidationCommand } = await aws()
  const features = await fetchSource()
  const previous = await readMeta()
  // Hash the zones alone: the timestamps below change every run by definition.
  const hash = createHash('sha256').update(JSON.stringify(features)).digest('hex')
  const changed = hash !== previous.hash
  const now = new Date().toISOString()
  const fetchedAt = changed ? now : (previous.fetchedAt ?? now)

  const body = JSON.stringify({
    type: 'FeatureCollection',
    version: 1,
    /** When the zones last actually changed. */
    fetchedAt,
    /** When we last confirmed them against the source. */
    checkedAt: now,
    source: SOURCE_URL,
    attribution: ATTRIBUTION,
    features,
  })

  await s3.send(
    new PutObjectCommand({
      Bucket: SITE_BUCKET,
      Key: KEY,
      Body: body,
      ContentType: 'application/json',
      // Matches the rest of data/; CloudFront compresses it on the way out.
      CacheControl: 'public, max-age=300, must-revalidate',
    }),
  )
  if (changed) {
    await cloudfront.send(
      new CreateInvalidationCommand({
        DistributionId: DISTRIBUTION_ID,
        InvalidationBatch: {
          CallerReference: `zones-${Date.now()}`,
          Paths: { Quantity: 1, Items: [`/${KEY}`] },
        },
      }),
    )
  }
  await db.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: {
        pk: { S: META_PK },
        hash: { S: hash },
        fetchedAt: { S: fetchedAt },
        checkedAt: { S: now },
        zoneCount: { N: String(features.length) },
        bytes: { N: String(Buffer.byteLength(body)) },
      },
    }),
  )
  console.log(`published ${features.length} zones (${Buffer.byteLength(body)} B), changed=${changed}`)
  return { fetchedAt, checkedAt: now, changed, count: features.length }
}

// ---------- manual-refresh throttle ----------

/**
 * Atomic check-and-increment against one counter. The condition and the
 * increment are the same DynamoDB call, so two simultaneous refreshes cannot
 * both slip past a limit. Returns how many are left, or null when spent.
 */
async function claim(pk, limit, ttlSeconds) {
  const { db, UpdateItemCommand } = await aws()
  try {
    const out = await db.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { pk: { S: pk } },
        UpdateExpression: 'ADD n :one SET expiresAt = :exp',
        ConditionExpression: 'attribute_not_exists(n) OR n < :limit',
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':limit': { N: String(limit) },
          ':exp': { N: String(Math.floor(Date.now() / 1000) + ttlSeconds) },
        },
        ReturnValues: 'UPDATED_NEW',
      }),
    )
    return Math.max(0, limit - Number(out.Attributes.n.N))
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return null
    throw err
  }
}

/** A per-client key that cannot be turned back into an IP. Rotates daily with the salt. */
const clientKey = (ip, day) => createHmac('sha256', IP_SALT).update(`${ip}|${day}`).digest('hex').slice(0, 32)

async function manualRefresh(event) {
  const ip = event.requestContext?.http?.sourceIp ?? 'unknown'
  const now = new Date()
  const day = now.toISOString().slice(0, 10)
  const hour = now.toISOString().slice(0, 13)

  // Per-client first: a single abuser then burns their own quota, not the
  // shared hourly one everybody else depends on.
  const client = await claim(`zones#cli#${clientKey(ip, day)}`, PER_CLIENT_DAILY, 2 * 24 * 3600)
  if (client === null) {
    return res(429, { error: `Only ${PER_CLIENT_DAILY} manual refreshes per day — the hourly schedule keeps running.` })
  }
  const global = await claim(`zones#rate#${hour}`, GLOBAL_HOURLY, 2 * 3600)
  if (global === null) {
    return res(429, { error: `The map was refreshed ${GLOBAL_HOURLY} times this hour already — try again shortly.` })
  }

  try {
    const result = await refresh()
    return res(200, { ...result, remaining: { client, global } })
  } catch (err) {
    console.error('manual refresh failed:', err)
    // The source being down is not the caller's fault, but the quota is already
    // spent — saying so is better than a bare 502.
    return res(502, { error: 'The airspace source did not answer. The scheduled copy is still current.' })
  }
}

// ---------- entry ----------

export const handler = async (event) => {
  // API Gateway payload v2 carries requestContext.http; EventBridge does not.
  if (event?.requestContext?.http) {
    if (event.routeKey !== 'POST /zones/refresh') return res(405, { error: 'method not allowed' })
    return manualRefresh(event)
  }
  return refresh()
}

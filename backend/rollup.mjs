/**
 * bando-map visit stats: fold CloudFront access logs into daily counts.
 *
 * Runs on a schedule (see infra/stats.tf). Every run is a full recompute of the
 * last DAYS days, so it is idempotent and self-healing — a missed or partial
 * run fixes itself next time, and nothing tracks which objects were already
 * read.
 *
 * Writes one item per day to the sync table:
 *   pk = stat#YYYY-MM-DD, data = { views, visitors, botViews, other,
 *                                  countries: {EE: n}, botCountries: {US: n} }
 *
 * Aggregates only. Viewer IPs are used inside a single run to count distinct
 * visitors and are never stored — a day's item holds the count, not the
 * addresses. The raw logs do carry them, and S3 expires those after seven
 * years (stats_log_retention_days in infra/stats.tf). The daily items written
 * here have no expiry, so the visit history outlives the logs it came from.
 */
import { gunzipSync } from 'node:zlib'
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'

const db = new DynamoDBClient({})
const s3 = new S3Client({})

const TABLE = process.env.TABLE_NAME
const BUCKET = process.env.LOG_BUCKET
const PREFIX = process.env.LOG_PREFIX
const DAYS = Number(process.env.DAYS ?? 2)

// Self-identified crawlers, previewers and scripted clients. Anything that
// doesn't run JavaScript won't be honest about it either way, so this is a
// hint for triage, not a verdict — the panel shows both halves.
const BOT_UA =
  /bot|crawl|spider|slurp|search|scrape|scrapy|headless|preview|monitor|check|fetch|curl|wget|httpx|okhttp|python-requests|aiohttp|go-http-client|libwww|java\/|axios|node-fetch|facebookexternalhit|whatsapp|telegram|discord|slackbot|semrush|ahrefs|mj12|dotbot|petal|yandex|baidu|bytespider|gptbot|claudebot|ccbot|perplexity/i

// Only the app shell counts as a page view. Unknown paths also return the shell
// (the SPA 403 fallback), but counting those would turn every /wp-login.php
// probe into a visit, so they land in `other` instead.
const PAGE_PATHS = new Set(['/', '/index.html'])

const dayKey = (d) => d.toISOString().slice(0, 10)

/** The UTC days a run recomputes, newest first. */
function windowDays(now, days) {
  const out = []
  for (let i = 0; i < days; i++) out.push(dayKey(new Date(now.getTime() - i * 86_400_000)))
  return out
}

async function listObjects(prefix) {
  const keys = []
  let token
  do {
    const out = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
    )
    for (const o of out.Contents ?? []) keys.push(o.Key)
    token = out.IsTruncated ? out.NextContinuationToken : undefined
  } while (token)
  return keys
}

async function readObject(key) {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  const buf = Buffer.from(await out.Body.transformToByteArray())
  // Vended logs arrive gzipped; tolerate plain objects too.
  const body = key.endsWith('.gz') || (buf[0] === 0x1f && buf[1] === 0x8b) ? gunzipSync(buf) : buf
  return body.toString('utf8')
}

/**
 * One log record as a field->value object. The delivery is configured for JSON
 * output, but tab/space-delimited w3c text is parsed too (a `#Fields:` header
 * names the columns) so a format change doesn't silently zero the stats.
 */
function* parseRecords(text) {
  let fields
  for (const line of text.split('\n')) {
    const raw = line.trim()
    if (!raw) continue
    if (raw.startsWith('#')) {
      const header = raw.match(/^#Fields:\s*(.*)$/i)
      if (header) fields = header[1].trim().split(/\s+/)
      continue
    }
    if (raw.startsWith('{')) {
      try {
        yield JSON.parse(raw)
      } catch {
        /* skip a truncated line rather than lose the object */
      }
      continue
    }
    if (!fields) continue
    const parts = raw.split(/\t/).length > 1 ? raw.split(/\t/) : raw.split(/\s+/)
    yield Object.fromEntries(fields.map((f, i) => [f, parts[i]]))
  }
}

const decode = (value) => {
  if (!value || value === '-') return ''
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

const emptyDay = () => ({ views: 0, visitors: 0, botViews: 0, other: 0, countries: {}, botCountries: {} })

/**
 * Group records by the date they carry (not the partition they were delivered
 * into — a request at 23:59 is often delivered into the next day's folder).
 */
function aggregate(records, wanted) {
  const days = new Map(wanted.map((d) => [d, { ...emptyDay(), ips: new Set() }]))
  for (const r of records) {
    const day = days.get(r.date)
    if (!day) continue
    const status = Number(r['sc-status'])
    if (!Number.isFinite(status) || status >= 400) continue
    const country = (r['c-country'] || '??').toUpperCase()
    if (!PAGE_PATHS.has(r['cs-uri-stem'])) {
      day.other++
      continue
    }
    const ua = decode(r['cs(User-Agent)'])
    if (!ua || BOT_UA.test(ua)) {
      day.botViews++
      day.botCountries[country] = (day.botCountries[country] ?? 0) + 1
      continue
    }
    day.views++
    day.countries[country] = (day.countries[country] ?? 0) + 1
    if (r['c-ip']) day.ips.add(r['c-ip'])
  }
  return new Map(
    [...days].map(([date, { ips, ...rest }]) => [date, { ...rest, visitors: ips.size }]),
  )
}

async function writeDay(date, counts) {
  await db.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: {
        pk: { S: `stat#${date}` },
        data: { S: JSON.stringify(counts) },
        updatedAt: { S: new Date().toISOString() },
      },
    }),
  )
}

export const handler = async (event = {}) => {
  const days = windowDays(new Date(), Number(event.days ?? DAYS))
  // A day's records sit in that day's folder or the next one (a request at 23:59
  // is usually delivered after midnight), and the newest folder here is today —
  // so the window's own folders already cover every day it recomputes.
  const folders = days.map((day) => `${PREFIX}/${day.slice(0, 4)}/${day.slice(5, 7)}/${day.slice(8, 10)}/`)

  const keys = (await Promise.all(folders.map(listObjects))).flat()
  const records = []
  // Small batches: a day of this site's traffic is a few hundred tiny objects.
  for (let i = 0; i < keys.length; i += 10) {
    const texts = await Promise.all(keys.slice(i, i + 10).map(readObject))
    for (const text of texts) records.push(...parseRecords(text))
  }

  const counts = aggregate(records, days)
  for (const [date, day] of counts) await writeDay(date, day)

  const summary = [...counts].map(([date, d]) => `${date}: ${d.views} views / ${d.visitors} visitors / ${d.botViews} bot`)
  console.log(`[stats] ${keys.length} objects, ${records.length} records — ${summary.join(', ')}`)
  return { objects: keys.length, records: records.length, days: Object.fromEntries(counts) }
}

// Exported for local testing against a saved log file.
export { aggregate, parseRecords, windowDays }

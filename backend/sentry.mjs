/**
 * Error reporting for the Lambdas: one POST, no dependency, no layer.
 *
 * Sentry publishes an SDK layer that does this and much more, and it was
 * measured here before this file existed. It cost about 1.3 s of extra cold
 * start on every cold `bando-map-sync` invocation, and it held roughly 70 MB
 * resident — enough that a photo upload, which already peaked at 199 MB
 * decoding base64, would have cleared the function's 256 MB and been killed.
 * Reporting a fault is not worth causing one.
 *
 * So this sends the one thing that matters: the exception, with real file names
 * and line numbers, the release it came from, and the Lambda request id with a
 * link to the log stream that holds the rest.
 *
 * What it deliberately does not do:
 *
 * - No breadcrumbs. CloudWatch already holds the console output, and every
 *   event here links straight to the right log stream.
 * - No automatic capture. Only what `reporting()` wraps is caught, which is
 *   every handler in this directory.
 * - No timeout warning. A timeout shows in CloudWatch as a Task timed out line
 *   and in the duration metric.
 * - Nothing about the caller. The event carries no request, no headers and no
 *   user — every call to this API carries an `authorization: Bearer` header
 *   with an email address inside the token, and none of it belongs here.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const DSN = process.env.SENTRY_DSN ?? ''
const RELEASE = process.env.SENTRY_RELEASE
const FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME
const REGION = process.env.AWS_REGION
const TASK_ROOT = process.env.LAMBDA_TASK_ROOT ?? '/var/task'

/**
 * Give up rather than spend the invocation's budget on the reporter. The
 * report is already the second-most important thing happening.
 */
const TIMEOUT_MS = 2000

/**
 * A DSN is `https://<key>@<host>/<project>`, and the ingest URL is those three
 * parts rearranged. No DSN means no URL, which makes every call below a no-op —
 * that is how a local run reports nothing.
 */
const INGEST_URL = (() => {
  const parts = /^https:\/\/([0-9a-f]+)@([^/]+)\/(\d+)$/.exec(DSN)
  if (!parts) return undefined
  const [, key, host, project] = parts
  return `https://${host}/api/${project}/envelope/?sentry_version=7&sentry_key=${key}`
})()

/** `    at name (file:///var/task/handler.mjs:759:13)`, with the name optional. */
const STACK_LINE = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/

/**
 * Node writes the innermost call first; Sentry draws the innermost call last.
 * Reversing here is what makes the issue title name the line that threw.
 */
function framesOf(stack) {
  return String(stack ?? '')
    .split('\n')
    .map((line) => STACK_LINE.exec(line))
    .filter((m) => m !== null)
    .map(([, fn, file, lineno, colno]) => {
      const filename = file.replace(/^file:\/\//, '')
      return {
        function: fn ?? '<anonymous>',
        filename,
        lineno: Number(lineno),
        colno: Number(colno),
        // Our own files against the runtime's. There are no dependencies here,
        // so everything else is Node itself.
        in_app: filename.startsWith(TASK_ROOT),
      }
    })
    .map(withSource)
    .reverse()
}

/**
 * Our own source, for the few lines around a frame. The deployed file is the
 * file that threw — no bundler, no minifier — so reading it back is the whole
 * of what a source map would have done. Cached per container, and only ever
 * touched on the error path.
 */
const sources = new Map()
function sourceLines(filename) {
  if (!sources.has(filename)) {
    try {
      sources.set(filename, readFileSync(filename, 'utf8').split('\n'))
    } catch {
      sources.set(filename, undefined)
    }
  }
  return sources.get(filename)
}

function withSource(frame) {
  const lines = frame.in_app ? sourceLines(frame.filename) : undefined
  if (!lines) return frame
  const i = frame.lineno - 1
  return {
    ...frame,
    pre_context: lines.slice(Math.max(0, i - 5), i),
    context_line: lines[i],
    post_context: lines.slice(i + 1, i + 6),
  }
}

/** Where the rest of this invocation is written down. */
function logsUrl(ctx) {
  if (!ctx?.logGroupName || !ctx.logStreamName) return undefined
  const group = encodeURIComponent(ctx.logGroupName)
  const stream = encodeURIComponent(ctx.logStreamName)
  return `https://console.aws.amazon.com/cloudwatch/home?region=${REGION}#logsV2:log-groups/log-group/${group}/log-events/${stream}?filterPattern=%22${ctx.awsRequestId}%22`
}

function eventBody(err, ctx) {
  const error = err instanceof Error ? err : new Error(String(err))
  return {
    event_id: randomUUID().replace(/-/g, ''),
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    release: RELEASE,
    environment: 'production',
    server_name: FUNCTION_NAME,
    // No `transaction`: with none set, Sentry names the issue after the
    // frame that threw, which is the useful half of the subtitle.
    tags: { function: FUNCTION_NAME, region: REGION },
    contexts: { runtime: { name: 'node', version: process.version } },
    extra: { aws_request_id: ctx?.awsRequestId, cloudwatch_logs: logsUrl(ctx) },
    exception: {
      values: [
        {
          type: error.name,
          value: error.message,
          stacktrace: { frames: framesOf(error.stack) },
          mechanism: { type: 'lambda', handled: false },
        },
      ],
    },
  }
}

/**
 * Send one exception and wait for it. Waiting is the whole trick: Lambda
 * freezes the process the moment the handler returns, and a request still in
 * flight is a request that never arrives.
 *
 * Never throws. A reporter that can fail the invocation it is reporting on is
 * worse than no reporter.
 */
export async function captureException(err, ctx) {
  if (!INGEST_URL) return
  try {
    const event = eventBody(err, ctx)
    const envelope = [
      JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n')
    await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope' },
      body: envelope,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (reportingFailed) {
    console.warn('sentry: could not report:', reportingFailed?.message)
  }
}

/**
 * Wrap a Lambda handler so that anything it throws is reported before it
 * leaves. The error is re-thrown untouched, so the runtime still fails the
 * invocation and CloudWatch still holds the full trace.
 */
export const reporting =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args)
    } catch (err) {
      await captureException(err, args[1])
      throw err
    }
  }

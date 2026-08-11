/**
 * Sync API for bando-map: one UserData document per signed-in user.
 *
 *   GET /sync  -> { data: UserData, updatedAt }   (404 until the first push)
 *   PUT /sync  <- UserData                         -> { updatedAt }
 *
 * Authentication happens before this code runs — the API Gateway JWT
 * authorizer validates the Cognito ID token and passes its claims through.
 * Merging is the client's job (per-mark updatedAt, same as JSON import);
 * the server just stores the latest merged document per user.
 */
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb'

const db = new DynamoDBClient({})
const TABLE = process.env.TABLE_NAME
// DynamoDB items cap at 400 KB; leave headroom for the key and metadata.
const MAX_BYTES = 350_000

const res = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const handler = async (event) => {
  const sub = event.requestContext?.authorizer?.jwt?.claims?.sub
  if (!sub) return res(401, { error: 'unauthenticated' })

  const method = event.requestContext?.http?.method
  if (method === 'GET') {
    const out = await db.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: sub } } }))
    if (!out.Item) return res(404, { error: 'no data yet' })
    return res(200, { data: JSON.parse(out.Item.data.S), updatedAt: out.Item.updatedAt.S })
  }

  if (method === 'PUT') {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString() : (event.body ?? '')
    if (raw.length > MAX_BYTES) return res(413, { error: `payload exceeds ${MAX_BYTES} bytes` })
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
        Item: { pk: { S: sub }, data: { S: JSON.stringify(data) }, updatedAt: { S: updatedAt } },
      }),
    )
    return res(200, { updatedAt })
  }

  return res(405, { error: 'method not allowed' })
}

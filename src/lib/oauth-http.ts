import { BodyTooLargeError, readBodyLimited } from './http'
import { OAuthError } from './oauth'

const MAX_BODY_BYTES = 16 * 1024

/**
 * These endpoints use no cookies, so any origin may call them; browser-based
 * MCP clients need that to discover and register.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
}

export function oauthJson(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...headers },
  })
}

export const preflight = () => new Response(null, { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' } })

/** An OAuthError as its RFC 6749 §5.2 error body; anything else is rethrown. */
export function oauthErrorResponse(err: unknown) {
  if (!(err instanceof OAuthError)) throw err
  console.warn(`oauth: ${err.code}: ${err.message}`)
  return oauthJson(
    { error: err.code, error_description: err.message },
    err.status,
    err.status === 401 ? { 'www-authenticate': 'Basic realm="linkify"' } : {},
  )
}

/** Token and revocation parameters: form-encoded per the spec, or JSON, which some clients send. */
export async function readParams(request: Request): Promise<Record<string, string>> {
  let text: string
  try {
    text = await readBodyLimited(request, MAX_BODY_BYTES)
  } catch (err) {
    if (err instanceof BodyTooLargeError) throw new OAuthError('invalid_request', 'Request body too large', 413)
    throw err
  }
  const type = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (type.startsWith('application/json')) {
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new OAuthError('invalid_request', 'Body is not valid JSON')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OAuthError('invalid_request', 'Body must be an object')
    return Object.fromEntries(Object.entries(body).filter((e): e is [string, string] => typeof e[1] === 'string'))
  }
  return Object.fromEntries(new URLSearchParams(text))
}

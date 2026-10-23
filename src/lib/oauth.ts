/**
 * OAuth 2.1 for the MCP server, so hosts like Claude and ChatGPT can connect
 * by having the user sign in and approve, instead of pasting an API key.
 * https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
 *
 * Pure helpers shared by the endpoints and the consent page: no database or
 * Node crypto, so they can be unit-tested and bundled for the browser.
 */
import { API_SCOPES, type ApiScope } from './api-scopes.ts'

export const ACCESS_TOKEN_TTL_SEC = 60 * 60
/** Sliding: each refresh renews it, so only connections left idle this long lapse. */
export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60
export const CODE_TTL_SEC = 5 * 60

export const MCP_PATH = '/api/mcp'
export const AUTHORIZE_PATH = '/oauth/authorize'
export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'

const MAX_REDIRECT_URIS = 10
const MAX_URI_LENGTH = 2000
const MAX_CLIENT_NAME = 100

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export class OAuthError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '')

/**
 * The origin this app is served from: the authorization server's issuer.
 * BETTER_AUTH_URL, where the session cookie lives, wins over the request's own origin.
 */
export function issuerFor(requestUrl: string) {
  const configured = process.env.BETTER_AUTH_URL
  return configured ? new URL(configured).origin : new URL(requestUrl).origin
}

/** The MCP endpoint's URL as a client reaches it: the resource tokens are issued for. */
export function resourceFor(requestUrl: string) {
  return `${new URL(requestUrl).origin}${MCP_PATH}`
}

/** RFC 9728 metadata telling MCP clients where to get a token. */
export function protectedResourceMetadata(requestUrl: string) {
  return {
    resource: resourceFor(requestUrl),
    authorization_servers: [issuerFor(requestUrl)],
    scopes_supported: [...API_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Linkify',
  }
}

/** RFC 8414 authorization server metadata. */
export function authorizationServerMetadata(requestUrl: string) {
  const issuer = issuerFor(requestUrl)
  return {
    issuer,
    authorization_endpoint: `${issuer}${AUTHORIZE_PATH}`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    scopes_supported: [...API_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  }
}

/**
 * Resource URLs (RFC 8707) a client may ask a token for: the MCP endpoint on
 * any origin this deployment answers on.
 */
export function acceptedResources(requestUrl: string) {
  const origins = [new URL(requestUrl).origin, process.env.BETTER_AUTH_URL, process.env.APP_BASE_URL]
  return new Set(origins.filter((o): o is string => Boolean(o)).map((o) => `${new URL(o).origin}${MCP_PATH}`))
}

/** Throws invalid_target unless `resource` is absent or names this MCP server. */
export function checkResource(resource: unknown, requestUrl: string) {
  if (resource === undefined || resource === null || resource === '') return
  if (typeof resource !== 'string' || !acceptedResources(requestUrl).has(stripTrailingSlash(resource))) {
    throw new OAuthError('invalid_target', 'Tokens can only be issued for this server\'s MCP endpoint')
  }
}

/**
 * Requested scopes, as a space-separated `scope` parameter, narrowed to the
 * ones this server knows. Unknown scopes (e.g. `openid`) are ignored rather
 * than refused, and asking for none means all of them.
 */
export function parseScope(scope: unknown): ApiScope[] {
  if (typeof scope !== 'string' || !scope.trim()) return [...API_SCOPES]
  const requested = new Set(scope.split(/\s+/))
  const known = API_SCOPES.filter((s) => requested.has(s))
  return known.length > 0 ? known : [...API_SCOPES]
}

function isLoopback(url: URL) {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
}

/**
 * Validates a redirect URI at registration: HTTPS, http on loopback (native
 * apps, RFC 8252), or a private-use scheme like `cursor://`; never a fragment.
 */
export function validateRedirectUri(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > MAX_URI_LENGTH) {
    throw new OAuthError('invalid_redirect_uri', 'Each redirect URI must be a URL')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new OAuthError('invalid_redirect_uri', `Invalid redirect URI: ${value}`)
  }
  if (url.hash || value.includes('#')) throw new OAuthError('invalid_redirect_uri', 'Redirect URIs cannot have a fragment')
  const scheme = url.protocol.slice(0, -1)
  const privateUse = /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+$|^(cursor|vscode|vscode-insiders|windsurf|zed)$/.test(scheme)
  if (url.protocol !== 'https:' && !isLoopback(url) && !privateUse) {
    throw new OAuthError('invalid_redirect_uri', 'Redirect URIs must use HTTPS, or http on localhost')
  }
  return value
}

/**
 * Whether `candidate` exactly matches a registered redirect URI. Loopback
 * URIs may use any port, since native apps pick a free one per sign-in (RFC 8252 §7.3).
 */
export function redirectUriMatches(registered: string[], candidate: string) {
  if (registered.includes(candidate)) return true
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return false
  }
  if (!isLoopback(url)) return false
  return registered.some((uri) => {
    const reg = new URL(uri)
    if (!isLoopback(reg)) return false
    reg.port = url.port
    return reg.href === url.href
  })
}

export interface ClientRegistration {
  name: string
  redirectUris: string[]
  authMethod: 'none' | 'client_secret_basic' | 'client_secret_post'
}

/** Validates an RFC 7591 registration request body. */
export function parseRegistration(body: unknown): ClientRegistration {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new OAuthError('invalid_client_metadata', 'Body must be a JSON object')
  }
  const value = body as Record<string, unknown>
  const uris = value.redirect_uris
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    throw new OAuthError('invalid_redirect_uri', `redirect_uris must list 1–${MAX_REDIRECT_URIS} URIs`)
  }
  const redirectUris = [...new Set(uris.map(validateRedirectUri))]

  const method = value.token_endpoint_auth_method ?? 'none'
  if (method !== 'none' && method !== 'client_secret_basic' && method !== 'client_secret_post') {
    throw new OAuthError('invalid_client_metadata', `Unsupported token_endpoint_auth_method: ${String(method)}`)
  }
  for (const [field, allowed] of [['grant_types', ['authorization_code', 'refresh_token']], ['response_types', ['code']]] as const) {
    const list = value[field]
    if (list === undefined) continue
    if (!Array.isArray(list) || list.some((item) => !(allowed as readonly unknown[]).includes(item))) {
      throw new OAuthError('invalid_client_metadata', `Unsupported ${field}; this server allows ${allowed.join(', ')}`)
    }
  }
  const rawName = typeof value.client_name === 'string' ? value.client_name : ''
  // Control characters and runs of whitespace could disguise the name on the consent screen.
  const name = rawName.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CLIENT_NAME)
  return { name: name || 'Unnamed app', redirectUris, authMethod: method }
}

/** A PKCE S256 code challenge: base64url of a SHA-256 digest. */
export function isCodeChallenge(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

/** A PKCE code verifier (RFC 7636 §4.1). */
export function isCodeVerifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(value)
}

/** `uri` with query parameters added, keeping any it already has. */
export function withParams(uri: string, params: Record<string, string | undefined>) {
  const url = new URL(uri)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return url.href
}

/** The host a redirect sends the user to, shown on the consent screen so a misleading client name can't hide it. */
export function redirectTarget(uri: string) {
  const url = new URL(uri)
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.host : `${url.protocol}//`
}

/** Database side of the MCP OAuth server: clients, codes, and grants. Server-only. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, count, eq, gt, ne, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from './db'
import { oauthClients, oauthCodes, oauthGrants, user, type OAuthClient } from './schema'
import { sha256 } from './keys'
import { hitLimit } from './ratelimit'
import { accountRestriction, isGuest } from './account-policy'
import {
  ACCESS_TOKEN_TTL_SEC, CODE_TTL_SEC, OAuthError, REFRESH_TOKEN_TTL_SEC, isCodeVerifier, parseScope,
  type ClientRegistration,
} from './oauth'

/** Caps the connections one account can hold; each approval of an app replaces its previous one. */
export const MAX_GRANTS_PER_USER = 50

const token = (prefix: string) => `${prefix}${randomBytes(32).toString('base64url')}`

function secretMatches(provided: string, expectedHash: string) {
  const left = Buffer.from(sha256(provided), 'hex')
  const right = Buffer.from(expectedHash, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function registerClient(registration: ClientRegistration) {
  const id = `lkc_${nanoid(24)}`
  const secret = registration.authMethod === 'none' ? null : token('lks_')
  const [row] = await db
    .insert(oauthClients)
    .values({
      id,
      name: registration.name,
      redirectUris: registration.redirectUris,
      authMethod: registration.authMethod,
      secretHash: secret ? sha256(secret) : null,
    })
    .returning()
  return { client: row, secret }
}

export async function findClient(id: unknown) {
  if (typeof id !== 'string' || !id || id.length > 64) return null
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, id))
  return row ?? null
}

/**
 * Identify the client calling the token or revocation endpoint: by
 * `client_id` for public clients, or by its secret (HTTP Basic or in the
 * body) for confidential ones.
 */
export async function authenticateClient(headers: Headers, params: Record<string, string>): Promise<OAuthClient> {
  let clientId = params.client_id
  let secret = params.client_secret
  const basic = headers.get('authorization')?.match(/^Basic\s+(.+)$/i)
  if (basic) {
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8')
    const colon = decoded.indexOf(':')
    if (colon < 0) throw new OAuthError('invalid_client', 'Malformed client credentials', 401)
    clientId = decodeURIComponent(decoded.slice(0, colon))
    secret = decodeURIComponent(decoded.slice(colon + 1))
  }
  const client = await findClient(clientId)
  if (!client) throw new OAuthError('invalid_client', 'Unknown client', 401)
  if (client.secretHash && !(secret && secretMatches(secret, client.secretHash))) {
    throw new OAuthError('invalid_client', 'Client authentication failed', 401)
  }
  return client
}

/** The user, if their account may still use the API: not restricted and not a guest. */
async function activeUser(userId: string) {
  const [row] = await db.select().from(user).where(eq(user.id, userId))
  if (!row || accountRestriction(row) || isGuest(row)) return null
  return row
}

export async function createAuthorizationCode(input: {
  clientId: string
  userId: string
  redirectUri: string
  codeChallenge: string
  scopes: string[]
}) {
  const code = token('')
  await db.insert(oauthCodes).values({
    codeHash: sha256(code),
    ...input,
    expiresAt: new Date(Date.now() + CODE_TTL_SEC * 1000),
  })
  return code
}

function tokenResponse(accessToken: string, refreshToken: string, scopes: string[]) {
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: refreshToken,
    scope: scopes.join(' '),
  }
}

function freshTokens() {
  const accessToken = token('lka_')
  const refreshToken = token('lkr_')
  const now = Date.now()
  return {
    accessToken,
    refreshToken,
    columns: {
      accessTokenHash: sha256(accessToken),
      accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_SEC * 1000),
      refreshTokenHash: sha256(refreshToken),
      refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_SEC * 1000),
    },
  }
}

/** The authorization_code grant: trade a code and its PKCE verifier for tokens. */
export async function exchangeCode(client: OAuthClient, params: Record<string, string>) {
  if (!params.code) throw new OAuthError('invalid_request', 'code is required')
  if (!isCodeVerifier(params.code_verifier)) throw new OAuthError('invalid_request', 'A valid code_verifier is required')
  // Deleting as it's read makes the code single-use, even under concurrent requests.
  const [code] = await db.delete(oauthCodes).where(eq(oauthCodes.codeHash, sha256(params.code))).returning()
  if (!code || code.expiresAt <= new Date() || code.clientId !== client.id) {
    throw new OAuthError('invalid_grant', 'The authorization code is invalid or expired')
  }
  if (params.redirect_uri && params.redirect_uri !== code.redirectUri) {
    throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request')
  }
  const challenge = createHash('sha256').update(params.code_verifier).digest('base64url')
  if (challenge !== code.codeChallenge) throw new OAuthError('invalid_grant', 'PKCE verification failed')
  if (!(await activeUser(code.userId))) throw new OAuthError('invalid_grant', 'This account can no longer authorize apps')

  const { accessToken, refreshToken, columns } = freshTokens()
  const id = nanoid()
  await db.insert(oauthGrants).values({ id, clientId: client.id, userId: code.userId, scopes: code.scopes, ...columns })
  // Reconnecting an app replaces its earlier connection instead of piling up grants.
  await db
    .delete(oauthGrants)
    .where(and(eq(oauthGrants.userId, code.userId), eq(oauthGrants.clientId, client.id), ne(oauthGrants.id, id)))
  return tokenResponse(accessToken, refreshToken, code.scopes)
}

/** The refresh_token grant: rotates both tokens, so a refresh token works once. */
export async function refreshGrant(client: OAuthClient, params: Record<string, string>) {
  if (!params.refresh_token) throw new OAuthError('invalid_request', 'refresh_token is required')
  const [grant] = await db
    .select()
    .from(oauthGrants)
    .where(and(
      eq(oauthGrants.refreshTokenHash, sha256(params.refresh_token)),
      eq(oauthGrants.clientId, client.id),
      gt(oauthGrants.refreshExpiresAt, new Date()),
    ))
  if (!grant) throw new OAuthError('invalid_grant', 'The refresh token is invalid or expired')
  if (params.scope && parseScope(params.scope).some((scope) => !grant.scopes.includes(scope))) {
    throw new OAuthError('invalid_scope', 'A refresh cannot add scopes the user did not approve')
  }
  if (!(await activeUser(grant.userId))) throw new OAuthError('invalid_grant', 'This account can no longer use apps')

  const { accessToken, refreshToken, columns } = freshTokens()
  // Conditional on the old hash, so of two concurrent refreshes only one wins.
  const rotated = await db
    .update(oauthGrants)
    .set(columns)
    .where(and(eq(oauthGrants.id, grant.id), eq(oauthGrants.refreshTokenHash, grant.refreshTokenHash)))
    .returning({ id: oauthGrants.id })
  if (rotated.length === 0) throw new OAuthError('invalid_grant', 'The refresh token is invalid or expired')
  return tokenResponse(accessToken, refreshToken, grant.scopes)
}

/** RFC 7009: forget the grant behind an access or refresh token. Unknown tokens are not an error. */
export async function revokeToken(client: OAuthClient, value: string) {
  const hash = sha256(value)
  await db
    .delete(oauthGrants)
    .where(and(
      eq(oauthGrants.clientId, client.id),
      or(eq(oauthGrants.accessTokenHash, hash), eq(oauthGrants.refreshTokenHash, hash)),
    ))
}

export async function grantCount(userId: string) {
  const [{ value }] = await db.select({ value: count() }).from(oauthGrants).where(eq(oauthGrants.userId, userId))
  return value
}

/**
 * Resolve a Bearer OAuth access token to its grant, like resolveApiKey does
 * for API keys: expired tokens, restricted owners, and guests are refused,
 * and requests share a per-grant rate limit.
 */
export async function resolveAccessToken(request: Request) {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(lka_\S+)$/i)
  if (!match) return null
  const [row] = await db
    .select({ grant: oauthGrants, owner: user })
    .from(oauthGrants)
    .innerJoin(user, eq(oauthGrants.userId, user.id))
    .where(eq(oauthGrants.accessTokenHash, sha256(match[1])))
  if (!row || row.grant.accessExpiresAt <= new Date()) return null
  if (accountRestriction(row.owner) || isGuest(row.owner)) return null
  const limit = await hitLimit(`api:${row.grant.id}`, 600, 60 * 1000)
  if (!limit.allowed) return null
  db.update(oauthGrants)
    .set({ lastUsedAt: new Date() })
    .where(eq(oauthGrants.id, row.grant.id))
    .execute()
    .catch(() => {})
  return { id: row.grant.id, userId: row.grant.userId, role: row.owner.role, scopes: row.grant.scopes }
}

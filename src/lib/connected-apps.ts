/** Server functions behind the OAuth consent page and the Connected apps settings card. */
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, getRequestUrl } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { auth } from './auth'
import { db } from './db'
import { oauthGrants } from './schema'
import { auditEvent } from './audit'
import { API_SCOPES, type ApiScope } from './api-scopes'
import { GUEST_READ_ONLY, accountRestriction, isGuest } from './account-policy'
import {
  OAuthError, checkResource, isCodeChallenge, issuerFor, parseScope, redirectTarget, redirectUriMatches, withParams,
} from './oauth'
import { MAX_GRANTS_PER_USER, createAuthorizationCode, findClient, grantCount } from './oauth-store'

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input')
  return input as Record<string, unknown>
}

/** Why the signed-in user can't connect an app, or null when they can. */
function connectRestriction(user: { role: string; twoFactorEnabled?: boolean | null; mustChangePassword?: boolean | null; deactivatedAt?: Date | null }) {
  if (isGuest(user)) return "Guest accounts are read-only and can't connect apps."
  return accountRestriction(user)
}

export interface AuthorizationParams {
  clientId: string
  redirectUri: string
  codeChallenge: string
  state?: string
}

export type AuthorizationView =
  /** The request can't be trusted to redirect anywhere: show the problem here. */
  | { kind: 'invalid'; message: string }
  /** Report an error back to the client. */
  | { kind: 'redirect'; url: string }
  | { kind: 'signed-out' }
  | { kind: 'blocked'; message: string }
  | {
    kind: 'consent'
    clientName: string
    redirectHost: string
    account: string
    scopes: ApiScope[]
    params: AuthorizationParams
    denyUrl: string
  }

/**
 * Validate an authorization request (the query string the MCP client sent
 * the browser here with) and decide what the page should show. Problems with
 * the client or redirect URI are shown here; anything else goes back to the
 * client as an OAuth error, per RFC 6749 §4.1.2.1.
 */
export const getAuthorizationRequest = createServerFn({ method: 'GET' })
  .validator((input: unknown) => asObject(input))
  .handler(async ({ data }): Promise<AuthorizationView> => {
    const client = await findClient(data.client_id)
    if (!client) return { kind: 'invalid', message: 'This app is not registered with Linkify. Try connecting again from the app.' }
    let redirectUri = str(data.redirect_uri)
    if (!redirectUri && client.redirectUris.length === 1) redirectUri = client.redirectUris[0]
    if (!redirectUri || !redirectUriMatches(client.redirectUris, redirectUri)) {
      return { kind: 'invalid', message: "The app's redirect address doesn't match the one it registered." }
    }

    const requestUrl = getRequestUrl().href
    const state = str(data.state)
    const iss = issuerFor(requestUrl)
    const fail = (error: string, description: string): AuthorizationView => ({
      kind: 'redirect',
      url: withParams(redirectUri, { error, error_description: description, state, iss }),
    })
    if (data.response_type !== 'code') return fail('unsupported_response_type', 'response_type must be code')
    if (data.code_challenge_method !== 'S256' || !isCodeChallenge(data.code_challenge)) {
      return fail('invalid_request', 'PKCE with code_challenge_method S256 is required')
    }
    try {
      checkResource(data.resource, requestUrl)
    } catch (err) {
      if (err instanceof OAuthError) return fail(err.code, err.message)
      throw err
    }

    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    if (!session) return { kind: 'signed-out' }
    const restriction = connectRestriction(session.user)
    if (restriction) return { kind: 'blocked', message: restriction }

    return {
      kind: 'consent',
      clientName: client.name,
      redirectHost: redirectTarget(redirectUri),
      account: session.user.displayUsername ?? session.user.email,
      scopes: parseScope(data.scope),
      params: { clientId: client.id, redirectUri, codeChallenge: data.code_challenge, state },
      denyUrl: withParams(redirectUri, { error: 'access_denied', error_description: 'The user denied access', state, iss }),
    }
  })

/** The user approved: issue an authorization code and return where to send the browser. */
export const approveAuthorization = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const value = asObject(input)
    const scopes = value.scopes
    if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some((s) => !API_SCOPES.includes(s as ApiScope))) {
      throw new Error('Select at least one permission')
    }
    if (typeof value.clientId !== 'string' || typeof value.redirectUri !== 'string' || !isCodeChallenge(value.codeChallenge)) {
      throw new Error('Invalid authorization request')
    }
    if (value.state !== undefined && (typeof value.state !== 'string' || value.state.length > 2000)) {
      throw new Error('Invalid authorization request')
    }
    return {
      clientId: value.clientId,
      redirectUri: value.redirectUri,
      codeChallenge: value.codeChallenge,
      state: value.state as string | undefined,
      scopes: [...new Set(scopes)] as ApiScope[],
    }
  })
  .handler(async ({ data }) => {
    const headers = getRequestHeaders()
    const session = await auth.api.getSession({ headers })
    if (!session) throw new Error('Unauthorized')
    const restriction = connectRestriction(session.user)
    if (restriction) throw new Error(restriction)
    const client = await findClient(data.clientId)
    if (!client || !redirectUriMatches(client.redirectUris, data.redirectUri)) throw new Error('Invalid authorization request')
    if (await grantCount(session.user.id) >= MAX_GRANTS_PER_USER) {
      throw new Error('Disconnect an app in Settings before connecting another')
    }

    const code = await createAuthorizationCode({
      clientId: client.id,
      userId: session.user.id,
      redirectUri: data.redirectUri,
      codeChallenge: data.codeChallenge,
      scopes: data.scopes,
    })
    await auditEvent({
      action: 'oauth.app_authorized', actorUserId: session.user.id, targetType: 'oauth_client', targetId: client.id,
      headers, metadata: { name: client.name, scopes: data.scopes },
    })
    return { url: withParams(data.redirectUri, { code, state: data.state, iss: issuerFor(getRequestUrl().href) }) }
  })

export const disconnectApp = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const id = asObject(input).id
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid app')
    return { id }
  })
  .handler(async ({ data }) => {
    const headers = getRequestHeaders()
    const session = await auth.api.getSession({ headers })
    if (!session) throw new Error('Unauthorized')
    if (isGuest(session.user)) throw new Error(GUEST_READ_ONLY)
    await db.delete(oauthGrants).where(and(eq(oauthGrants.id, data.id), eq(oauthGrants.userId, session.user.id)))
    await auditEvent({
      action: 'oauth.app_disconnected', actorUserId: session.user.id, targetType: 'oauth_grant', targetId: data.id, headers,
    })
    return { ok: true }
  })

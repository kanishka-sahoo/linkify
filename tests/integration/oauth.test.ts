import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  callServerFn, createUser, mcpClient, migrate, pool, query, resetDb, sessionCookie, skip, startApp, type App,
} from './harness.ts'

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

describe('OAuth for the MCP server', { skip }, () => {
  let app: App
  before(async () => {
    migrate()
    app = await startApp()
  })
  after(async () => {
    await app?.stop()
    await pool.end()
  })
  beforeEach(resetDb)

  const getJson = async (path: string) => {
    const res = await fetch(`${app.baseUrl}${path}`)
    return { status: res.status, headers: res.headers, body: await res.json() }
  }

  const register = async (body: Record<string, unknown> = {}) => {
    const res = await fetch(`${app.baseUrl}/api/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', ...body }),
    })
    return { status: res.status, body: await res.json() }
  }

  const token = async (params: Record<string, string>, headers: Record<string, string> = {}) => {
    const res = await fetch(`${app.baseUrl}/api/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(params),
    })
    return { status: res.status, body: await res.json() }
  }

  /** Approve `clientId` as `userId` the way the consent page does; returns the redirect URL. */
  async function approve(userId: string, clientId: string, challenge: string, scopes = ['links:read', 'links:write', 'stats:read']) {
    const cookie = await sessionCookie(app, userId)
    const res = await callServerFn(app, 'approveAuthorization', {
      clientId, redirectUri: REDIRECT, codeChallenge: challenge, state: 'xyz', scopes,
    }, cookie)
    return res
  }

  /** Register, approve, and exchange the code: what Claude or ChatGPT does when a user connects. */
  async function connect(userId: string, scopes?: string[]) {
    const { body: client } = await register()
    const { verifier, challenge } = pkce()
    const res = await approve(userId, client.client_id, challenge, scopes)
    assert.equal(res.status, 200, res.body)
    const url = new URL(res.body.match(/https:\/\/claude\.ai[^"]+/)![0])
    assert.equal(url.searchParams.get('state'), 'xyz')
    assert.equal(url.searchParams.get('iss'), app.baseUrl)
    const code = url.searchParams.get('code')!
    const tokens = await token({
      grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: REDIRECT,
      resource: `${app.baseUrl}/api/mcp`,
    })
    assert.equal(tokens.status, 200, JSON.stringify(tokens.body))
    return { client, code, verifier, tokens: tokens.body }
  }

  test('discovery: a 401 from the MCP endpoint leads to the authorization server', async () => {
    const res = await fetch(`${app.baseUrl}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(res.status, 401)
    const challenge = res.headers.get('www-authenticate')!
    const metadataUrl = challenge.match(/resource_metadata="([^"]+)"/)![1]
    assert.equal(metadataUrl, `${app.baseUrl}/.well-known/oauth-protected-resource/api/mcp`)

    const resource = await getJson(new URL(metadataUrl).pathname)
    assert.equal(resource.status, 200)
    assert.equal(resource.headers.get('access-control-allow-origin'), '*')
    assert.equal(resource.body.resource, `${app.baseUrl}/api/mcp`)
    assert.deepEqual(resource.body.authorization_servers, [app.baseUrl])
    assert.deepEqual((await getJson('/.well-known/oauth-protected-resource')).body, resource.body)

    const server = await getJson('/.well-known/oauth-authorization-server')
    assert.equal(server.status, 200)
    assert.equal(server.body.issuer, app.baseUrl)
    assert.equal(server.body.registration_endpoint, `${app.baseUrl}/api/oauth/register`)
    assert.equal(server.body.authorization_endpoint, `${app.baseUrl}/oauth/authorize`)
  })

  test('registration validates redirect URIs and only issues secrets to confidential clients', async () => {
    const pub = await register()
    assert.equal(pub.status, 201)
    assert.match(pub.body.client_id, /^lkc_/)
    assert.equal(pub.body.client_secret, undefined)
    assert.deepEqual(pub.body.redirect_uris, [REDIRECT])

    const confidential = await register({ token_endpoint_auth_method: 'client_secret_basic' })
    assert.equal(confidential.status, 201)
    assert.match(confidential.body.client_secret, /^lks_/)

    const bad = await register({ redirect_uris: ['http://evil.example/cb'] })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error, 'invalid_redirect_uri')
  })

  test('the full flow: approve, exchange, call tools, refresh, revoke', async () => {
    const userId = await createUser()
    const { client, code, verifier, tokens } = await connect(userId)
    assert.match(tokens.access_token, /^lka_/)
    assert.match(tokens.refresh_token, /^lkr_/)
    assert.equal(tokens.token_type, 'Bearer')
    assert.equal(tokens.expires_in, 3600)
    assert.equal(tokens.scope, 'links:read links:write stats:read')

    const mcp = mcpClient(app, tokens.access_token)
    const created = await mcp.call('create_link', { url: 'https://example.com', code: 'via-oauth' })
    assert.equal(created.isError, false)
    const [owner] = await query(`select user_id from links where code = 'via-oauth'`)
    assert.equal(owner.user_id, userId)

    // Codes are single-use.
    const replay = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id })
    assert.equal(replay.status, 400)
    assert.equal(replay.body.error, 'invalid_grant')

    const refreshed = await token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id })
    assert.equal(refreshed.status, 200)
    assert.notEqual(refreshed.body.access_token, tokens.access_token)
    // Rotation: the old refresh and access tokens stop working.
    const reused = await token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id })
    assert.equal(reused.body.error, 'invalid_grant')
    const stale = await mcpClient(app, tokens.access_token).request('tools/list')
    assert.equal(stale.status, 401)
    assert.match(stale.headers.get('www-authenticate')!, /error="invalid_token"/)
    assert.equal((await mcpClient(app, refreshed.body.access_token).request('tools/list')).status, 200)

    const revoke = await fetch(`${app.baseUrl}/api/oauth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshed.body.refresh_token, client_id: client.client_id }),
    })
    assert.equal(revoke.status, 200)
    assert.equal((await mcpClient(app, refreshed.body.access_token).request('tools/list')).status, 401)
  })

  test('the token carries only the scopes the user approved', async () => {
    const { tokens } = await connect(await createUser(), ['links:read'])
    assert.equal(tokens.scope, 'links:read')
    const list = await mcpClient(app, tokens.access_token).request('tools/list')
    const names = list.body.result.tools.map((t: { name: string }) => t.name).sort()
    assert.deepEqual(names, ['get_link', 'list_links'])
  })

  test('PKCE, client, and redirect URI must match the authorization', async () => {
    const userId = await createUser()
    const { body: client } = await register()
    const { body: other } = await register()
    const exchange = async (overrides: Record<string, string>) => {
      const { verifier, challenge } = pkce()
      const res = await approve(userId, client.client_id, challenge)
      const code = new URL(res.body.match(/https:\/\/claude\.ai[^"]+/)![0]).searchParams.get('code')!
      return token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, ...overrides })
    }
    assert.equal((await exchange({ code_verifier: pkce().verifier })).body.error, 'invalid_grant')
    assert.equal((await exchange({ client_id: other.client_id })).body.error, 'invalid_grant')
    assert.equal((await exchange({ redirect_uri: 'https://claude.ai/other' })).body.error, 'invalid_grant')
    assert.equal((await exchange({ resource: 'https://evil.example/api/mcp' })).body.error, 'invalid_target')
    assert.equal((await exchange({ client_id: 'lkc_missing' })).status, 401)
    assert.equal((await exchange({})).status, 200)
  })

  test('confidential clients must present their secret', async () => {
    const userId = await createUser()
    const { body: client } = await register({ token_endpoint_auth_method: 'client_secret_basic' })
    const { verifier, challenge } = pkce()
    const res = await approve(userId, client.client_id, challenge)
    const code = new URL(res.body.match(/https:\/\/claude\.ai[^"]+/)![0]).searchParams.get('code')!
    const params = { grant_type: 'authorization_code', code, code_verifier: verifier }
    const noSecret = await token({ ...params, client_id: client.client_id })
    assert.equal(noSecret.status, 401)
    assert.equal(noSecret.body.error, 'invalid_client')
    const basic = Buffer.from(`${client.client_id}:${client.client_secret}`).toString('base64')
    assert.equal((await token(params, { authorization: `Basic ${basic}` })).status, 200)
  })

  test('guests and restricted accounts cannot connect apps', async () => {
    const { body: client } = await register()
    const guest = await createUser()
    await query(`update "user" set role = 'guest' where id = $1`, [guest])
    const admin = await createUser({ role: 'admin', twoFactorEnabled: false })
    for (const [userId, reason] of [[guest, /read-only/], [admin, /two-factor/]] as const) {
      const res = await approve(userId, client.client_id, pkce().challenge)
      assert.match(res.body, reason)
      assert.doesNotMatch(res.body, /code=/)
    }
    const [{ count }] = await query(`select count(*)::int as count from oauth_codes`)
    assert.equal(count, 0)
  })

  test('tokens stop working once the account is restricted or the app is disconnected', async () => {
    const userId = await createUser()
    const { tokens } = await connect(userId)
    await query(`update "user" set must_change_password = true where id = $1`, [userId])
    assert.equal((await mcpClient(app, tokens.access_token).request('tools/list')).status, 401)
    await query(`update "user" set must_change_password = false where id = $1`, [userId])
    assert.equal((await mcpClient(app, tokens.access_token).request('tools/list')).status, 200)

    const [grant] = await query(`select id from oauth_grants where user_id = $1`, [userId])
    const res = await callServerFn(app, 'disconnectApp', { id: grant.id }, await sessionCookie(app, userId))
    assert.equal(res.status, 200)
    assert.equal((await mcpClient(app, tokens.access_token).request('tools/list')).status, 401)
  })

  test('reconnecting an app replaces its earlier grant', async () => {
    const userId = await createUser()
    const { body: client } = await register()
    for (let i = 0; i < 2; i++) {
      const { verifier, challenge } = pkce()
      const res = await approve(userId, client.client_id, challenge)
      const code = new URL(res.body.match(/https:\/\/claude\.ai[^"]+/)![0]).searchParams.get('code')!
      assert.equal((await token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id })).status, 200)
    }
    const [{ count }] = await query(`select count(*)::int as count from oauth_grants where user_id = $1`, [userId])
    assert.equal(count, 1)
  })

  test('the consent page sends signed-out users to sign in and back', async () => {
    const { body: client } = await register()
    const qs = new URLSearchParams({
      response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT,
      code_challenge: pkce().challenge, code_challenge_method: 'S256', state: 's',
    })
    const res = await fetch(`${app.baseUrl}/oauth/authorize?${qs}`, { redirect: 'manual' })
    assert.equal(res.status, 307)
    const location = new URL(res.headers.get('location')!, app.baseUrl)
    assert.equal(location.pathname, '/login')
    assert.equal(location.searchParams.get('redirect'), `/oauth/authorize?${qs}`)

    const signedIn = await fetch(`${app.baseUrl}/oauth/authorize?${qs}`, {
      headers: { cookie: await sessionCookie(app, await createUser()) },
    })
    assert.equal(signedIn.status, 200)
    const html = await signedIn.text()
    assert.match(html, /Connect /)
    assert.match(html, /claude\.ai/)
  })
})

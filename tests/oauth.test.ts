import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OAuthError, authorizationServerMetadata, checkResource, isCodeChallenge, isCodeVerifier, parseRegistration, parseScope,
  protectedResourceMetadata, redirectTarget, redirectUriMatches, validateRedirectUri, withParams,
} from '../src/lib/oauth.ts'

const rejects = (fn: () => unknown, code: string) =>
  assert.throws(fn, (err) => err instanceof OAuthError && err.code === code)

test('metadata points clients from the MCP endpoint to the authorization server', () => {
  delete process.env.BETTER_AUTH_URL
  const resource = protectedResourceMetadata('https://links.example/.well-known/oauth-protected-resource/api/mcp')
  assert.equal(resource.resource, 'https://links.example/api/mcp')
  assert.deepEqual(resource.authorization_servers, ['https://links.example'])
  assert.deepEqual(resource.scopes_supported, ['links:read', 'links:write', 'stats:read'])

  const server = authorizationServerMetadata('https://links.example/.well-known/oauth-authorization-server')
  assert.equal(server.issuer, 'https://links.example')
  assert.equal(server.authorization_endpoint, 'https://links.example/oauth/authorize')
  assert.equal(server.token_endpoint, 'https://links.example/api/oauth/token')
  assert.equal(server.registration_endpoint, 'https://links.example/api/oauth/register')
  assert.deepEqual(server.code_challenge_methods_supported, ['S256'])
})

test('the configured auth URL is the issuer, wherever metadata is fetched from', () => {
  process.env.BETTER_AUTH_URL = 'https://app.example/'
  try {
    assert.equal(authorizationServerMetadata('https://short.example/x').issuer, 'https://app.example')
    assert.deepEqual(protectedResourceMetadata('https://short.example/x').authorization_servers, ['https://app.example'])
  } finally {
    delete process.env.BETTER_AUTH_URL
  }
})

test('resource indicators must name this MCP endpoint', () => {
  const url = 'https://links.example/api/oauth/token'
  checkResource(undefined, url)
  checkResource('https://links.example/api/mcp', url)
  checkResource('https://links.example/api/mcp/', url)
  rejects(() => checkResource('https://evil.example/api/mcp', url), 'invalid_target')
  rejects(() => checkResource('https://links.example/api/v1/links', url), 'invalid_target')
})

test('scopes: unknown ones are ignored and none means all', () => {
  assert.deepEqual(parseScope(undefined), ['links:read', 'links:write', 'stats:read'])
  assert.deepEqual(parseScope('stats:read openid links:read'), ['links:read', 'stats:read'])
  assert.deepEqual(parseScope('openid profile'), ['links:read', 'links:write', 'stats:read'])
})

test('redirect URIs: HTTPS, loopback http, or a private-use scheme', () => {
  validateRedirectUri('https://claude.ai/api/mcp/auth_callback')
  validateRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect')
  validateRedirectUri('http://localhost:33418/callback')
  validateRedirectUri('http://127.0.0.1/callback')
  validateRedirectUri('cursor://anysphere.cursor-retrieval/oauth/callback')
  validateRedirectUri('com.example.app:/oauth')
  rejects(() => validateRedirectUri('http://example.com/callback'), 'invalid_redirect_uri')
  rejects(() => validateRedirectUri('https://example.com/cb#frag'), 'invalid_redirect_uri')
  rejects(() => validateRedirectUri('javascript:alert(1)'), 'invalid_redirect_uri')
  rejects(() => validateRedirectUri('data:text/html,hi'), 'invalid_redirect_uri')
  rejects(() => validateRedirectUri('not a url'), 'invalid_redirect_uri')
})

test('redirect URIs match exactly, except loopback ports', () => {
  const registered = ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1:5000/callback']
  assert.ok(redirectUriMatches(registered, 'https://claude.ai/api/mcp/auth_callback'))
  assert.ok(!redirectUriMatches(registered, 'https://claude.ai/api/mcp/auth_callback/'))
  assert.ok(!redirectUriMatches(registered, 'https://claude.ai/api/mcp/auth_callback?x=1'))
  assert.ok(redirectUriMatches(registered, 'http://127.0.0.1:61234/callback'))
  assert.ok(!redirectUriMatches(registered, 'http://127.0.0.1:61234/other'))
  assert.ok(!redirectUriMatches(registered, 'http://localhost:5000/callback'))
})

test('registration: validated, with a sanitized name and public clients by default', () => {
  const reg = parseRegistration({
    client_name: '  Claude‮\n  Desktop ',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback', 'https://claude.ai/api/mcp/auth_callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  })
  assert.deepEqual(reg, { name: 'Claude Desktop', redirectUris: ['https://claude.ai/api/mcp/auth_callback'], authMethod: 'none' })
  assert.equal(parseRegistration({ redirect_uris: ['https://a.example/cb'] }).name, 'Unnamed app')
  assert.equal(
    parseRegistration({ redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'client_secret_post' }).authMethod,
    'client_secret_post',
  )
  rejects(() => parseRegistration({ redirect_uris: [] }), 'invalid_redirect_uri')
  rejects(() => parseRegistration({}), 'invalid_redirect_uri')
  rejects(() => parseRegistration([]), 'invalid_client_metadata')
  rejects(() => parseRegistration({ redirect_uris: ['https://a.example/cb'], grant_types: ['implicit'] }), 'invalid_client_metadata')
  rejects(() => parseRegistration({ redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'private_key_jwt' }), 'invalid_client_metadata')
})

test('PKCE values', () => {
  assert.ok(isCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'))
  assert.ok(!isCodeChallenge('short'))
  assert.ok(!isCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM'))
  assert.ok(isCodeVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
  assert.ok(!isCodeVerifier('x'.repeat(42)))
  assert.ok(!isCodeVerifier('x'.repeat(129)))
})

test('redirect helpers', () => {
  assert.equal(
    withParams('https://claude.ai/cb?keep=1', { code: 'a b', state: undefined, iss: 'https://links.example' }),
    'https://claude.ai/cb?keep=1&code=a+b&iss=https%3A%2F%2Flinks.example',
  )
  assert.equal(redirectTarget('https://claude.ai/api/mcp/auth_callback'), 'claude.ai')
  assert.equal(redirectTarget('http://127.0.0.1:5000/cb'), '127.0.0.1:5000')
  assert.equal(redirectTarget('cursor://anysphere.cursor-retrieval/oauth'), 'cursor://')
})

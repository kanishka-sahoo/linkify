#!/usr/bin/env node
/**
 * End-to-end smoke test of a running Linkify deployment's API: the REST API,
 * redirects, and the MCP server. It creates one temporary link and deletes it
 * again, even when a check fails.
 *
 *   LINKIFY_API_KEY=lk_... node scripts/smoke-api.mjs https://your-domain
 *
 * Give the key all three scopes (links:read, links:write, stats:read). Without
 * a key, only the unauthenticated checks run.
 */
const base = (process.argv[2] ?? process.env.LINKIFY_URL ?? '').replace(/\/+$/, '')
const key = process.env.LINKIFY_API_KEY ?? ''
if (!base) {
  console.error('usage: LINKIFY_API_KEY=lk_... node scripts/smoke-api.mjs https://your-domain')
  process.exit(2)
}

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${!ok && detail ? `\n         ${detail}` : ''}`)
  return ok
}

async function call(method, path, { body, headers = {}, auth = true, redirect = 'follow' } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect,
    headers: {
      ...(auth && key ? { authorization: `Bearer ${key}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, json, text }
}

const show = (res) => `HTTP ${res.status}: ${res.text.slice(0, 300)}`

console.log(`Linkify API smoke test against ${base}\n`)

console.log('Unauthenticated')
{
  const res = await call('GET', '/api/v1/links', { auth: false })
  check('GET /api/v1/links without a key → 401 JSON', res.status === 401 && res.json?.error === 'Unauthorized', show(res))
  const bad = await call('GET', '/api/v1/links', { auth: false, headers: { authorization: 'Bearer lk_invalid' } })
  check('an invalid key → 401 (not 500: the database is reachable)', bad.status === 401, show(bad))
  const mcp = await call('POST', '/api/mcp', { auth: false, body: { jsonrpc: '2.0', id: 1, method: 'ping' } })
  check('POST /api/mcp without a key → 401', mcp.status === 401, show(mcp))
  const resourceMetadata = mcp.headers.get('www-authenticate')?.match(/resource_metadata="([^"]+)"/)?.[1]
  if (check('the 401 advertises OAuth metadata (needed for Claude/ChatGPT connectors)', Boolean(resourceMetadata),
    `WWW-Authenticate: ${mcp.headers.get('www-authenticate')} — deploy the OAuth change`)) {
    const meta = await call('GET', new URL(resourceMetadata).pathname, { auth: false })
    check('protected resource metadata', meta.status === 200 && meta.json?.authorization_servers?.length > 0, show(meta))
    const server = await call('GET', '/.well-known/oauth-authorization-server', { auth: false })
    check('authorization server metadata', server.status === 200 && Boolean(server.json?.token_endpoint), show(server))
  }
}

if (!key) {
  console.log('\nSet LINKIFY_API_KEY to run the authenticated checks.')
  process.exit(failures ? 1 : 0)
}

console.log('\nREST API')
const code = `smoke-${Date.now().toString(36)}`
let linkId = null
try {
  const list = await call('GET', '/api/v1/links')
  if (!check('GET /api/v1/links → 200', list.status === 200 && Array.isArray(list.json?.links), show(list))) {
    if (list.status === 401) {
      console.log('         The key was rejected. It may be expired or deleted, or the owner may be deactivated,')
      console.log('         need to change a temporary password, or (for admins) need to enable 2FA. Repeated')
      console.log('         401s can also mean the key hit its 600 requests/minute limit.')
    }
    if (list.status === 403) console.log('         The key lacks the links:read scope.')
    throw new Error('stopping: the key does not work')
  }

  const created = await call('POST', '/api/v1/links', {
    body: { url: 'https://example.com/?smoke=1', code, title: 'Smoke test', tags: ['smoke'] },
  })
  check('POST /api/v1/links → 201', created.status === 201 && created.json?.code === code, show(created))
  linkId = created.json?.id ?? null
  if (!linkId) throw new Error('stopping: could not create the test link')

  const one = await call('GET', `/api/v1/links/${linkId}`)
  check('GET /api/v1/links/:id → 200', one.status === 200 && one.json?.url === 'https://example.com/?smoke=1', show(one))
  check('responses never include the password hash', !('passwordHash' in (one.json ?? {})), show(one))

  const visit = await call('GET', `/${code}`, { auth: false, redirect: 'manual' })
  check(`GET /${code} redirects to the target`, visit.status === 302 && visit.headers.get('location') === 'https://example.com/?smoke=1',
    `HTTP ${visit.status} location=${visit.headers.get('location')}`)

  const paused = await call('PATCH', `/api/v1/links/${linkId}`, { body: { status: 'paused' } })
  check('PATCH status=paused → 200', paused.status === 200 && paused.json?.status === 'paused', show(paused))
  const pausedVisit = await call('GET', `/${code}`, { auth: false, redirect: 'manual' })
  check('a paused link does not redirect', pausedVisit.status !== 302, `HTTP ${pausedVisit.status}`)

  const protectedLink = await call('PATCH', `/api/v1/links/${linkId}`, { body: { status: 'active', password: 'smoke-test-password' } })
  check('PATCH password → passwordProtected', protectedLink.status === 200 && protectedLink.json?.passwordProtected === true, show(protectedLink))
  const unprotected = await call('PATCH', `/api/v1/links/${linkId}`, { body: { password: null } })
  check('PATCH password=null removes protection', unprotected.status === 200 && unprotected.json?.passwordProtected === false, show(unprotected))

  const invalid = await call('POST', '/api/v1/links', { body: { url: 'not a url' } })
  check('an invalid URL → 400', invalid.status === 400, show(invalid))
  const wrongType = await call('POST', '/api/v1/links', { body: { url: 'https://example.com' }, headers: { 'content-type': 'text/plain' } })
  check('a non-JSON content type → 415', wrongType.status === 415, show(wrongType))

  const stats = await call('GET', `/api/v1/links/${linkId}/stats?days=7`)
  check('GET /api/v1/links/:id/stats → 200', stats.status === 200 && stats.json?.days === 7, show(stats))

  console.log('\nMCP server')
  const legacy = await call('POST', '/api/mcp', {
    headers: { 'mcp-protocol-version': '2025-06-18', accept: 'application/json, text/event-stream' },
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } },
  })
  check('initialize (2025-06-18) → 200', legacy.status === 200 && Boolean(legacy.json?.result?.serverInfo), show(legacy))

  const rpc = async (method, params = {}) => {
    const meta = {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {},
    }
    return call('POST', '/api/mcp', {
      headers: {
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(method === 'tools/call' ? { 'mcp-name': params.name } : {}),
        accept: 'application/json, text/event-stream',
      },
      body: { jsonrpc: '2.0', id: 2, method, params: { ...params, _meta: meta } },
    })
  }
  const discover = await rpc('server/discover')
  check('server/discover (2026-07-28) → 200', discover.status === 200 && Boolean(discover.json?.result?.capabilities), show(discover))
  const tools = await rpc('tools/list')
  const names = tools.json?.result?.tools?.map((t) => t.name) ?? []
  check('tools/list includes the link and stats tools', names.includes('get_link') && names.includes('get_link_stats'), show(tools))
  const got = await rpc('tools/call', { name: 'get_link', arguments: { link: code } })
  check('tools/call get_link finds the test link', got.status === 200 && got.json?.result?.structuredContent?.code === code, show(got))
  const linkStats = await rpc('tools/call', { name: 'get_link_stats', arguments: { link: code, days: 7 } })
  check('tools/call get_link_stats → result', linkStats.status === 200 && linkStats.json?.result?.isError === false, show(linkStats))
} catch (err) {
  console.log(`\n${err.message}`)
} finally {
  if (linkId) {
    console.log('\nCleanup')
    const removed = await call('DELETE', `/api/v1/links/${linkId}`)
    check('DELETE /api/v1/links/:id', removed.status === 200 || removed.status === 204, show(removed))
    const gone = await call('GET', `/api/v1/links/${linkId}`)
    check('the deleted link is gone → 404', gone.status === 404, show(gone))
  }
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
process.exit(failures ? 1 : 0)

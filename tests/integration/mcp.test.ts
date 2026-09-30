import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  client, createApiKey, createUser, mcpClient, migrate, pool, query, resetDb, skip, startApp, type App,
} from './harness.ts'

const toolNames = async (mcp: ReturnType<typeof mcpClient>) =>
  (await mcp.request('tools/list')).body.result.tools.map((t: { name: string }) => t.name).sort()

describe('MCP server', { skip }, () => {
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

  describe('transport', () => {
    test('initialize negotiates a version and the handshake completes', async () => {
      const mcp = mcpClient(app, await createApiKey(await createUser()))
      const init = await mcp.request('initialize', {
        protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' },
      })
      assert.equal(init.status, 200)
      assert.equal(init.headers.get('content-type'), 'application/json')
      assert.equal(init.body.result.protocolVersion, '2025-06-18')
      assert.deepEqual(init.body.result.serverInfo, { name: 'linkify', version: '1.0.0' })
      assert.ok(init.body.result.capabilities.tools)

      const initialized = await mcp.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-protocol-version': '2025-06-18' })
      assert.equal(initialized.status, 202)
      assert.equal(initialized.body, null)
      assert.equal((await mcp.request('ping')).body.result && true, true)
    })

    test('missing, unknown, expired, and restricted keys get 401', async () => {
      const statuses = async (key: string) => (await mcpClient(app, key).request('tools/list')).status
      const noAuth = await fetch(`${app.baseUrl}/api/mcp`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
      })
      assert.equal(noAuth.status, 401)
      assert.match(noAuth.headers.get('www-authenticate') ?? '', /^Bearer/)
      assert.equal(await statuses('lk_not_a_real_key'), 401)
      assert.equal(await statuses(await createApiKey(await createUser(), { expiresAt: new Date(Date.now() - 1000) })), 401)
      assert.equal(await statuses(await createApiKey(await createUser({ mustChangePassword: true }))), 401)
      assert.equal(await statuses(await createApiKey(await createUser({ role: 'admin', twoFactorEnabled: false }))), 401)
      const deactivated = await createUser()
      const deactivatedKey = await createApiKey(deactivated)
      await query(`update "user" set deactivated_at = now() where id = $1`, [deactivated])
      assert.equal(await statuses(deactivatedKey), 401)
    })

    test('GET and DELETE are not supported by this stateless server', async () => {
      const key = await createApiKey(await createUser())
      for (const method of ['GET', 'DELETE']) {
        const res = await fetch(`${app.baseUrl}/api/mcp`, { method, headers: { authorization: `Bearer ${key}` } })
        assert.equal(res.status, 405, method)
        assert.equal(res.headers.get('allow'), 'POST')
      }
    })

    test('malformed bodies, wrong content types, versions, and origins are rejected', async () => {
      const mcp = mcpClient(app, await createApiKey(await createUser()))
      const parse = await mcp.post('{not json')
      assert.equal(parse.status, 400)
      assert.equal(parse.body.error.code, -32700)

      assert.equal((await mcp.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'content-type': 'text/plain' })).status, 415)
      const version = await mcp.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'mcp-protocol-version': '1999-01-01' })
      assert.equal(version.status, 400)
      assert.equal((await mcp.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' })).status, 403)
      assert.equal((await mcp.post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: app.baseUrl })).status, 200)

      const tooBig = await mcp.post({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(70 * 1024) } })
      assert.equal(tooBig.status, 413)

      const unknown = await mcp.request('resources/list')
      assert.equal(unknown.body.error.code, -32601)
    })

    test('batches return one response per request', async () => {
      const mcp = mcpClient(app, await createApiKey(await createUser()))
      const res = await mcp.post([
        { jsonrpc: '2.0', id: 'a', method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 'b', method: 'tools/list' },
      ])
      assert.equal(res.status, 200)
      assert.deepEqual(res.body.map((r: { id: string }) => r.id), ['a', 'b'])
    })
  })

  describe('scopes', () => {
    test('tools/list only shows tools the key can call', async () => {
      const userId = await createUser()
      assert.deepEqual(await toolNames(mcpClient(app, await createApiKey(userId))), [
        'create_link', 'delete_link', 'get_analytics_overview', 'get_click_log', 'get_link', 'get_link_stats',
        'list_links', 'update_link',
      ])
      assert.deepEqual(await toolNames(mcpClient(app, await createApiKey(userId, { scopes: ['links:read'] }))), [
        'get_link', 'list_links',
      ])
      assert.deepEqual(await toolNames(mcpClient(app, await createApiKey(userId, { scopes: ['stats:read'] }))), [
        'get_analytics_overview', 'get_click_log', 'get_link_stats',
      ])
    })

    test('calling a tool outside the key scopes fails without side effects', async () => {
      const userId = await createUser()
      const reader = mcpClient(app, await createApiKey(userId, { scopes: ['links:read'] }))
      const denied = await reader.call('create_link', { url: 'https://example.com' })
      assert.equal(denied.isError, true)
      assert.match((denied as { message: string }).message, /links:write/)
      assert.equal((await query('select count(*)::int as n from links'))[0].n, 0)

      const writer = mcpClient(app, await createApiKey(userId, { scopes: ['links:write'] }))
      const created = await writer.call('create_link', { url: 'https://example.com', code: 'w' })
      assert.equal(created.isError, false)
      assert.equal((await writer.call('get_link_stats', { link: 'w' })).isError, true)
      assert.equal((await writer.call('list_links')).isError, true)
    })
  })

  describe('link management', () => {
    test('create, read, update, and delete a link', async () => {
      const mcp = mcpClient(app, await createApiKey(await createUser()))
      const created = await mcp.call('create_link', {
        url: 'https://example.com/launch', code: 'launch', title: 'Launch', tags: ['Q4 Campaign', 'email'],
        password: 'hunter22',
      }) as Record<string, any>
      assert.equal(created.isError, false)
      assert.equal(created.code, 'launch')
      assert.equal(created.shortUrl, `${app.baseUrl}/launch`)
      assert.equal(created.state, 'active')
      assert.deepEqual(created.tags, ['q4-campaign', 'email'])
      assert.equal(created.passwordProtected, true)
      assert.equal('passwordHash' in created, false)

      const byCode = await mcp.call('get_link', { link: 'launch' }) as Record<string, any>
      const byId = await mcp.call('get_link', { link: created.id }) as Record<string, any>
      assert.equal(byCode.id, created.id)
      assert.equal(byId.code, 'launch')

      const updated = await mcp.call('update_link', {
        link: 'launch', code: 'launch-2', status: 'paused', password: null, maxClicks: 100,
      }) as Record<string, any>
      assert.equal(updated.code, 'launch-2')
      assert.equal(updated.status, 'paused')
      assert.equal(updated.state, 'paused')
      assert.equal(updated.passwordProtected, false)
      assert.equal(updated.maxClicks, 100)
      assert.equal(updated.title, 'Launch', 'omitted fields are unchanged')
      assert.equal(updated.url, 'https://example.com/launch')

      const cleared = await mcp.call('update_link', { link: created.id, title: null, maxClicks: null }) as Record<string, any>
      assert.equal(cleared.title, null)
      assert.equal(cleared.maxClicks, null)

      const deleted = await mcp.call('delete_link', { link: 'launch-2' })
      assert.deepEqual(deleted, { isError: false, deleted: true, id: created.id, code: 'launch-2' })
      assert.equal((await mcp.call('get_link', { link: created.id })).isError, true)
    })

    test('validation errors are tool errors the agent can read', async () => {
      const mcp = mcpClient(app, await createApiKey(await createUser()))
      const cases: [string, Record<string, unknown>, RegExp][] = [
        ['create_link', { url: 'ftp://example.com' }, /Invalid URL/],
        ['create_link', {}, /URL is required/],
        ['create_link', { url: 'https://example.com', code: 'dashboard' }, /reserved/],
        ['create_link', { url: 'https://example.com', startsAt: '2030-01-02T00:00:00Z', expiresAt: '2030-01-01T00:00:00Z' }, /after the scheduled start/],
        ['get_link', {}, /link id or short code/],
        ['get_link', { link: 'missing' }, /No link "missing"/],
        ['list_links', { limit: 0 }, /limit/],
        ['list_links', { state: 'deleted' }, /state/],
        ['get_link_stats', { link: 'missing', days: 400 }, /days/],
      ]
      for (const [tool, args, message] of cases) {
        const res = await mcp.call(tool, args)
        assert.equal(res.isError, true, `${tool} ${JSON.stringify(args)}`)
        assert.match((res as { message: string }).message, message)
      }

      await mcp.call('create_link', { url: 'https://example.com', code: 'taken' })
      await mcp.call('create_link', { url: 'https://example.com', code: 'other' })
      assert.match((await mcp.call('create_link', { url: 'https://example.com', code: 'taken' }) as { message: string }).message, /already taken/)
      assert.match((await mcp.call('update_link', { link: 'other', code: 'taken' }) as { message: string }).message, /already taken/)
      assert.match(
        (await mcp.call('update_link', { link: 'other', expiresAt: '2030-01-01T00:00:00Z', startsAt: '2031-01-01T00:00:00Z' }) as { message: string }).message,
        /after the scheduled start/,
      )
    })

    test('list_links searches and filters by tag and state, with paging', async () => {
      const mcp = mcpClient(app, await createApiKey(await createUser()))
      await mcp.call('create_link', { url: 'https://shop.example/sale', code: 'sale', tags: ['promo'] })
      await mcp.call('create_link', { url: 'https://blog.example/post', code: 'post', title: 'Summer sale recap' })
      await mcp.call('create_link', { url: 'https://example.com/paused', code: 'paused', status: 'paused', tags: ['promo'] })
      await mcp.call('create_link', { url: 'https://example.com/old', code: 'old', expiresAt: '2020-01-01T00:00:00Z' })

      const codes = async (args: Record<string, unknown>) => {
        const res = await mcp.call('list_links', args) as Record<string, any>
        return { total: res.total, codes: res.links.map((l: { code: string }) => l.code) }
      }
      assert.deepEqual(await codes({}), { total: 4, codes: ['old', 'paused', 'post', 'sale'] })
      assert.deepEqual(await codes({ query: 'SALE' }), { total: 2, codes: ['post', 'sale'] })
      assert.deepEqual(await codes({ tag: 'Promo' }), { total: 2, codes: ['paused', 'sale'] })
      assert.deepEqual(await codes({ state: 'paused' }), { total: 1, codes: ['paused'] })
      assert.deepEqual(await codes({ state: 'expired' }), { total: 1, codes: ['old'] })
      assert.deepEqual(await codes({ tag: 'promo', state: 'active' }), { total: 1, codes: ['sale'] })
      assert.deepEqual(await codes({ limit: 2, offset: 1 }), { total: 4, codes: ['paused', 'post'] })
    })

    test('writes are audited as mcp actions and share the REST creation rate limit', async () => {
      const userId = await createUser()
      const key = await createApiKey(userId)
      const mcp = mcpClient(app, key)
      const created = await mcp.call('create_link', { url: 'https://example.com', code: 'audited' }) as Record<string, any>
      await mcp.call('update_link', { link: 'audited', title: 'x' })
      await mcp.call('delete_link', { link: 'audited' })
      const actions = (await query(
        `select action from audit_logs where target_id = $1 order by created_at`, [created.id],
      )).map((r) => r.action)
      assert.deepEqual(actions, ['mcp.link.created', 'mcp.link.updated', 'mcp.link.deleted'])

      // 1 MCP link above + 28 REST + 1 MCP = 30; the 31st, from either path, is refused.
      const rest = client(app, key)
      for (let i = 0; i < 28; i++) assert.equal((await rest.create({ url: 'https://example.com' })).status, 201)
      assert.equal((await mcp.call('create_link', { url: 'https://example.com' })).isError, false)
      const limited = await mcp.call('create_link', { url: 'https://example.com' })
      assert.equal(limited.isError, true)
      assert.match((limited as { message: string }).message, /Rate limit.*retry in \d+s/)
      assert.equal((await rest.create({ url: 'https://example.com' })).status, 429)
    })
  })

  describe('ownership', () => {
    test("a user key cannot see, change, or delete another user's links", async () => {
      const owner = mcpClient(app, await createApiKey(await createUser()))
      const victim = await owner.call('create_link', { url: 'https://example.com/private', code: 'private' }) as Record<string, any>
      const intruder = mcpClient(app, await createApiKey(await createUser()))

      assert.equal(((await intruder.call('list_links')) as Record<string, any>).total, 0)
      for (const ref of ['private', victim.id]) {
        for (const [tool, extra] of [
          ['get_link', {}], ['update_link', { url: 'https://evil.example' }], ['delete_link', {}],
          ['get_link_stats', {}], ['get_click_log', {}],
        ] as const) {
          const res = await intruder.call(tool, { link: ref, ...extra })
          assert.equal(res.isError, true, `${tool} ${ref}`)
          assert.match((res as { message: string }).message, /No link/)
        }
      }
      // Renaming onto a taken code must not reveal whose it is beyond "taken", and must not touch it.
      await intruder.call('create_link', { url: 'https://example.com', code: 'mine' })
      assert.equal((await intruder.call('update_link', { link: 'mine', code: 'private' })).isError, true)

      const after = await owner.call('get_link', { link: 'private' }) as Record<string, any>
      assert.equal(after.url, 'https://example.com/private')
      assert.equal(((await intruder.call('get_analytics_overview')) as Record<string, any>).linkCount, 1)
    })

    test('an admin key sees and manages every link', async () => {
      const owner = mcpClient(app, await createApiKey(await createUser()))
      await owner.call('create_link', { url: 'https://example.com', code: 'users-link' })
      const admin = mcpClient(app, await createApiKey(await createUser({ role: 'admin', twoFactorEnabled: true })))
      assert.equal(((await admin.call('list_links')) as Record<string, any>).total, 1)
      assert.equal(((await admin.call('update_link', { link: 'users-link', status: 'paused' })) as Record<string, any>).status, 'paused')
      assert.equal(((await admin.call('get_analytics_overview')) as Record<string, any>).linkCount, 1)
    })
  })

  describe('analytics', () => {
    const addClick = (linkId: string, c: { country?: string; bot?: boolean; visitor?: string; outcome?: string; ip?: string; city?: string; ua?: string } = {}) =>
      query(
        `insert into clicks (id, link_id, timestamp, country, city, ip, user_agent, browser, os, device_type, is_bot, visitor_hash, outcome)
         values ($1, $2, now(), $3, $4, $5, $6, 'Firefox', 'Linux', 'desktop', $7, $8, $9)`,
        [randomBytes(8).toString('hex'), linkId, c.country ?? null, c.city ?? null, c.ip ?? null, c.ua ?? null,
          c.bot ?? false, c.visitor ?? null, c.outcome ?? 'redirected'],
      )

    test('stats, click log, and overview report recorded clicks', async () => {
      const mcp = mcpClient(app, await createApiKey(await createUser()))
      const link = await mcp.call('create_link', { url: 'https://example.com', code: 'stats' }) as Record<string, any>
      await addClick(link.id, { country: 'US', visitor: 'a', ip: '198.51.100.1', city: 'Austin', ua: 'Mozilla/5.0' })
      await addClick(link.id, { country: 'US', visitor: 'a' })
      await addClick(link.id, { country: 'DE', visitor: 'b' })
      await addClick(link.id, { bot: true, visitor: 'bot' })
      await addClick(link.id, { outcome: 'fallback', visitor: 'c' })
      await query(`update links set click_count = 4 where id = $1`, [link.id])

      const stats = await mcp.call('get_link_stats', { link: 'stats', days: 7 }) as Record<string, any>
      assert.equal(stats.isError, false)
      assert.equal(stats.days, 7)
      assert.equal(stats.series.length, 7)
      assert.equal(stats.human, 3)
      assert.equal(stats.bots, 1)
      assert.equal(stats.uniqueVisitors, 2)
      assert.equal(stats.totalClicksAllTime, 4)
      assert.deepEqual(stats.outcomes, { redirected: 4, fallback: 1, blocked: 0, password_failed: 0 })
      assert.deepEqual(stats.byCountry[0], { name: 'US', count: 2 })
      assert.deepEqual(new Set(stats.byCountry.slice(1).map(JSON.stringify)), new Set([
        JSON.stringify({ name: 'DE', count: 1 }), JSON.stringify({ name: null, count: 1 }),
      ]), 'ties are unordered')
      assert.deepEqual(stats.byBrowser, [{ name: 'Firefox', count: 4 }])
      assert.deepEqual(stats.byDevice, [{ name: 'desktop', count: 4 }])

      const page1 = await mcp.call('get_click_log', { link: 'stats', limit: 3 }) as Record<string, any>
      assert.equal(page1.clicks.length, 3)
      assert.ok(page1.nextCursor)
      const page2 = await mcp.call('get_click_log', { link: 'stats', limit: 3, cursor: page1.nextCursor }) as Record<string, any>
      assert.equal(page2.clicks.length, 2)
      assert.equal(page2.nextCursor, null)
      const all = [...page1.clicks, ...page2.clicks]
      assert.equal(all.length, 5)
      assert.equal('visitorHash' in all[0], false, 'pseudonymous visitor hashes are not exposed')
      assert.ok(all.some((c) => c.ip === '198.51.100.1' && c.city === 'Austin' && c.userAgent === 'Mozilla/5.0'))

      const humans = await mcp.call('get_click_log', { link: 'stats', humansOnly: true, country: 'US' }) as Record<string, any>
      assert.equal(humans.clicks.length, 2)
      assert.equal((await mcp.call('get_click_log', { link: 'stats', cursor: { ts: 'bad', id: 'x' } })).isError, true)

      const overview = await mcp.call('get_analytics_overview') as Record<string, any>
      assert.equal(overview.linkCount, 1)
      assert.equal(overview.clicks30d, 4)
      assert.equal(overview.bots30d, 1)
      assert.equal(overview.unique30d, 2)
      assert.deepEqual(overview.topLinks, [{ code: 'stats', title: null, clicks: 4, shortUrl: `${app.baseUrl}/stats` }])
    })

    test('the click log never exposes IP, city, or user agent for privacy-mode links', async () => {
      const mcp = mcpClient(app, await createApiKey(await createUser()))
      const link = await mcp.call('create_link', { url: 'https://example.com', code: 'private' }) as Record<string, any>
      await addClick(link.id, { ip: '198.51.100.9', city: 'Paris', ua: 'Mozilla/5.0', country: 'FR' })
      await mcp.call('update_link', { link: 'private', privacyEnabled: true })
      // Even if raw data were somehow left behind, the tool must not return it.
      await addClick(link.id, { ip: '198.51.100.10', city: 'Lyon', ua: 'curl/8', country: 'FR' })

      const log = await mcp.call('get_click_log', { link: 'private' }) as Record<string, any>
      assert.equal(log.clicks.length, 2)
      for (const click of log.clicks) {
        assert.equal(click.ip, null)
        assert.equal(click.city, null)
        assert.equal(click.userAgent, null)
        assert.equal(click.country, 'FR')
      }
      const [row] = await query(`select count(*)::int as n from clicks where link_id = $1 and ip is not null`, [link.id])
      assert.equal(row.n, 1, 'enabling privacy scrubbed the earlier click')
    })
  })
})

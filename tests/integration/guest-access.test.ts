import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  callServerFn, client, createApiKey, createUser, ip, migrate, pool, query, resetDb, sessionCookie, signIn, skip,
  startApp, type App,
} from './harness.ts'

const READS = new Set(['listLinks', 'getLinkStats', 'getClickLog', 'getSettingsData'])

// Read-only guest accounts whose credentials can be shared for a demo.
describe('guest accounts', { skip }, () => {
  let app: App
  let adminId: string
  let adminCookie: string
  before(async () => {
    migrate()
    app = await startApp()
  })
  after(async () => {
    await app?.stop()
    await pool.end()
  })
  beforeEach(async () => {
    await resetDb()
    adminId = await createUser({ role: 'admin', twoFactorEnabled: true })
    adminCookie = await sessionCookie(app, adminId)
  })

  const admin = (name: string, data: unknown) => callServerFn(app, name, data, adminCookie)

  /** A guest that can view `shared`'s links but not `hidden`'s, signed in over HTTP. */
  async function demo() {
    const shared = await createUser()
    const hidden = await createUser()
    const sharedLink = (await client(app, await createApiKey(shared)).create({ url: 'https://example.com/a', code: 'shared' })).body
    const hiddenLink = (await client(app, await createApiKey(hidden)).create({ url: 'https://example.com/b', code: 'hidden' })).body
    const res = await admin('createGuest', {
      name: 'Demo', email: 'demo@test.local', password: 'demo-password-123', ownerIds: [shared],
    })
    assert.equal(res.status, 200, res.body)
    const cookie = await signIn(app, 'demo@test.local', 'demo-password-123')
    const guest = (name: string, data: unknown = {}) => callServerFn(app, name, data, cookie, READS.has(name) ? 'GET' : 'POST')
    return { shared, hidden, sharedLink, hiddenLink, cookie, guest }
  }

  test('a guest is created read-only, without a password change requirement', async () => {
    await demo()
    const [row] = await query(`select role, must_change_password from "user" where email = 'demo@test.local'`)
    assert.deepEqual(row, { role: 'guest', must_change_password: false })
  })

  test('a guest sees only the accounts it was granted', async () => {
    const { guest } = await demo()
    const list = await guest('listLinks')
    assert.equal(list.status, 200)
    assert.match(list.body, /shared/)
    assert.doesNotMatch(list.body, /hidden/)
    assert.match((await guest('getLinkStats', { code: 'shared' })).body, /example\.com\/a/)
    const denied = (await guest('getLinkStats', { code: 'hidden' })).body
    assert.match(denied, /isNotFound/)
    assert.doesNotMatch(denied, /example\.com\/b/)
  })

  test('a guest cannot change links', async () => {
    const { guest, sharedLink } = await demo()
    const attempts = [
      guest('createLink', { url: 'https://evil.example' }),
      guest('updateLink', { id: sharedLink.id, code: 'shared', url: 'https://evil.example' }),
      guest('deleteLink', { id: sharedLink.id }),
      guest('bulkDeleteLinks', { ids: [sharedLink.id] }),
      guest('bulkExpireLinks', { ids: [sharedLink.id] }),
      guest('bulkUpdateLinks', { ids: [sharedLink.id], status: 'paused' }),
      guest('importLinks', { rows: [{ url: 'https://evil.example', code: 'shared' }], conflict: 'replace' }),
    ]
    for (const res of await Promise.all(attempts)) assert.match(res.body, /Guest accounts are read-only/)
    const [row] = await query('select url, status, expires_at from links where id = $1', [sharedLink.id])
    assert.deepEqual(row, { url: 'https://example.com/a', status: 'active', expires_at: null })
  })

  test('a guest cannot change its credentials, sessions, or API keys', async () => {
    const { guest, cookie } = await demo()
    for (const res of [
      await guest('changeMyPassword', { currentPassword: 'demo-password-123', newPassword: 'taken-over-password' }),
      await guest('revokeOtherSessions'),
      await guest('createApiKey', { name: 'k' }),
    ]) assert.match(res.body, /Guest accounts are read-only/)

    for (const [path, body] of [
      ['/change-password', { currentPassword: 'demo-password-123', newPassword: 'taken-over-password' }],
      ['/two-factor/enable', { password: 'demo-password-123' }],
      ['/update-user', { name: 'Pwned' }],
      ['/revoke-other-sessions', {}],
    ] as const) {
      const res = await fetch(`${app.baseUrl}/api/auth${path}`, {
        method: 'POST',
        headers: { origin: app.baseUrl, 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      })
      assert.equal(res.status, 403, path)
      assert.match(await res.text(), /Guest accounts are read-only/, path)
    }
    // The shared password still works.
    await signIn(app, 'demo@test.local', 'demo-password-123')
  })

  test("a guest's settings and click log don't expose other viewers or visitors", async () => {
    const { guest } = await demo()
    await signIn(app, 'demo@test.local', 'demo-password-123') // a second viewer
    await fetch(`${app.baseUrl}/shared`, { redirect: 'manual', headers: { 'x-real-ip': ip(1), 'user-agent': 'Visitor/1.0' } })

    const sessions = await query(`select s.id from session s join "user" u on u.id = s.user_id where u.email = 'demo@test.local'`)
    assert.equal(sessions.length, 2)
    const settings = (await guest('getSettingsData')).body
    for (const { id } of sessions) assert.equal(settings.includes(id), false)
    assert.deepEqual(await query('select ip, user_agent from clicks'), [{ ip: ip(1), user_agent: 'Visitor/1.0' }])
    const log = (await guest('getClickLog', { code: 'shared' })).body
    assert.match(log, /redirected/)
    assert.doesNotMatch(log, new RegExp(`${ip(1).replaceAll('.', '\\.')}|Visitor/1\\.0`))
  })

  test('admins can change which accounts a guest sees', async () => {
    const { guest, hidden } = await demo()
    const [{ id: guestId }] = await query(`select id from "user" where email = 'demo@test.local'`)
    assert.equal((await admin('setGuestAccess', { id: guestId, ownerIds: [hidden] })).status, 200)
    const list = (await guest('listLinks')).body
    assert.match(list, /hidden/)
    assert.doesNotMatch(list, /shared/)
    // Guests can't be granted to guests or receive links.
    assert.match((await admin('setGuestAccess', { id: guestId, ownerIds: [guestId] })).body, /can't be given access to other guests/)
    const link = (await client(app, await createApiKey(hidden)).list()).body.links[0]
    assert.match((await admin('bulkUpdateLinks', { ids: [link.id], ownerId: guestId })).body, /can't be transferred to a guest/)
    assert.match((await admin('setUserRole', { id: guestId, role: 'admin' })).body, /Guest accounts can't change role/)
  })
})

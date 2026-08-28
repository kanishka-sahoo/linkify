import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  client, createApiKey, createUser, migrate, pool, query, resetDb, skip, startApp, type App,
} from './harness.ts'

describe('API key authorization', { skip }, () => {
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

  test('a regular user key can create and list its links', async () => {
    const api = client(app, await createApiKey(await createUser()))
    const created = await api.create({ url: 'https://example.com', code: 'mine' })
    assert.equal(created.status, 201)
    const listed = await api.list()
    assert.equal(listed.status, 200)
    assert.deepEqual(listed.body.links.map((l: { code: string }) => l.code), ['mine'])
  })

  test('responses never expose the password hash', async () => {
    const api = client(app, await createApiKey(await createUser()))
    const created = await api.create({ url: 'https://example.com', password: 'correct horse' })
    assert.equal(created.body.passwordProtected, true)
    assert.equal('passwordHash' in created.body, false)
    const [listed] = (await api.list()).body.links
    assert.equal('passwordHash' in listed, false)
  })

  // Regression test for #7
  test('an admin key is rejected until the admin enrolls TOTP', async () => {
    const adminId = await createUser({ role: 'admin', twoFactorEnabled: false })
    const api = client(app, await createApiKey(adminId))
    assert.equal((await api.list()).status, 401)
    assert.equal((await api.create({ url: 'https://example.com' })).status, 401)

    await query(`update "user" set two_factor_enabled = true where id = $1`, [adminId])
    assert.equal((await api.list()).status, 200)
  })

  // Regression test for #7: the scenario from the security audit
  test("a promoted user's existing key cannot reach other users' links before TOTP", async () => {
    const victim = client(app, await createApiKey(await createUser()))
    const { body: victimLink } = await victim.create({ url: 'https://example.com/private' })

    const promotedId = await createUser()
    const promoted = client(app, await createApiKey(promotedId))
    await query(`update "user" set role = 'admin' where id = $1`, [promotedId])

    assert.equal((await promoted.list()).status, 401)
    assert.equal((await promoted.remove(victimLink.id)).status, 401)
    assert.equal((await victim.get(victimLink.id)).status, 200, 'victim link must survive')
  })

  test('a user who must change their temporary password is rejected', async () => {
    const api = client(app, await createApiKey(await createUser({ mustChangePassword: true })))
    assert.equal((await api.list()).status, 401)
  })

  test('scopes are enforced', async () => {
    const userId = await createUser()
    const readOnly = client(app, await createApiKey(userId, { scopes: ['links:read'] }))
    assert.equal((await readOnly.list()).status, 200)
    assert.equal((await readOnly.create({ url: 'https://example.com' })).status, 403)

    const writer = client(app, await createApiKey(userId, { scopes: ['links:write'] }))
    const { body: link } = await writer.create({ url: 'https://example.com' })
    assert.equal((await writer.stats(link.id)).status, 403)
    assert.equal((await writer.list()).status, 403)
  })

  test('expired and unknown keys are rejected', async () => {
    const expired = client(app, await createApiKey(await createUser(), { expiresAt: new Date(Date.now() - 1000) }))
    assert.equal((await expired.list()).status, 401)
    assert.equal((await client(app, 'lk_not_a_real_key').list()).status, 401)
  })
})

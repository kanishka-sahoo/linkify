import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  client, createApiKey, createUser, migrate, pool, query, resetDb, skip, startApp, type App,
} from './harness.ts'

describe('link ownership', { skip }, () => {
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

  async function twoUsersWithLink() {
    const alice = client(app, await createApiKey(await createUser()))
    const bob = client(app, await createApiKey(await createUser()))
    const { body: link } = await alice.create({ url: 'https://example.com/alice', code: 'alice' })
    return { alice, bob, link }
  }

  test("users cannot see each other's links", async () => {
    const { bob, link } = await twoUsersWithLink()
    assert.deepEqual((await bob.list()).body.links, [])
    assert.equal((await bob.get(link.id)).status, 404)
    assert.equal((await bob.stats(link.id)).status, 404)
  })

  test("users cannot modify or delete each other's links", async () => {
    const { alice, bob, link } = await twoUsersWithLink()
    assert.equal((await bob.update(link.id, { url: 'https://evil.example' })).status, 404)
    assert.equal((await bob.remove(link.id)).status, 404)

    const { body: after } = await alice.get(link.id)
    assert.equal(after.url, 'https://example.com/alice')
  })

  test('a taken code is reported without revealing whose it is', async () => {
    const { bob } = await twoUsersWithLink()
    const res = await bob.create({ url: 'https://example.com', code: 'alice' })
    assert.equal(res.status, 409)
    assert.equal('userId' in res.body, false)
  })

  test('admins with TOTP see and manage every link', async () => {
    const { link } = await twoUsersWithLink()
    const admin = client(app, await createApiKey(await createUser({ role: 'admin', twoFactorEnabled: true })))
    assert.deepEqual((await admin.list()).body.links.map((l: { code: string }) => l.code), ['alice'])
    assert.equal((await admin.stats(link.id)).status, 200)
    assert.equal((await admin.remove(link.id)).status, 200)
    assert.equal((await query('select 1 from links where id = $1', [link.id])).length, 0)
  })
})

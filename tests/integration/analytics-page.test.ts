import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  client, createApiKey, createUser, migrate, pool, resetDb, sessionCookie, skip, startApp, type App,
} from './harness.ts'

// Regression tests for #4
describe('link analytics page', { skip }, () => {
  let app: App
  let ownerId: string
  let cookie: string
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
    ownerId = await createUser()
    cookie = await sessionCookie(app, ownerId)
  })

  const page = async (code: string) => {
    const res = await fetch(`${app.baseUrl}/dashboard/links/${code}`, { headers: { cookie }, redirect: 'manual' })
    return { status: res.status, html: await res.text() }
  }

  test("renders the owner's link", async () => {
    await client(app, await createApiKey(ownerId)).create({ url: 'https://example.com', code: 'mine' })
    const { status, html } = await page('mine')
    assert.equal(status, 200)
    assert.match(html, /Clicks over time/)
  })

  test('an unknown code is a 404 inside the dashboard layout', async () => {
    const { status, html } = await page('doesnotexist')
    assert.equal(status, 404)
    assert.match(html, /Not found/)
    assert.match(html, /Back to dashboard/)
    assert.match(html, /Settings/, 'dashboard navigation should still render')
  })

  test("another user's link is indistinguishable from an unknown code", async () => {
    await client(app, await createApiKey(await createUser())).create({ url: 'https://example.com', code: 'theirs' })
    const { status, html } = await page('theirs')
    assert.equal(status, 404)
    assert.match(html, /Not found/)
    assert.doesNotMatch(html, /example\.com/)
  })

  test('an invalid or reserved code is a 404, not a 500', async () => {
    assert.equal((await page('api')).status, 404)
    assert.equal((await page('bad.code')).status, 404)
  })
})

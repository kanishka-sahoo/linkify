import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  client, createApiKey, createUser, migrate, pool, resetDb, sessionCookie, skip, startApp, type App,
} from './harness.ts'

// Regression test for #1: server-rendered dates must not depend on the
// server's locale or timezone, or hydration fails in the browser.
describe('server-rendered dates', { skip }, () => {
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

  test('the links table renders created dates in a fixed UTC form', async () => {
    const userId = await createUser()
    const created = await client(app, await createApiKey(userId)).create({
      url: 'https://example.com',
      code: 'dated',
      expiresAt: '2099-02-09T12:00:00.000Z',
    })
    assert.equal(created.status, 201)
    const res = await fetch(`${app.baseUrl}/dashboard`, { headers: { cookie: await sessionCookie(app, userId) } })
    const html = await res.text()
    const today = new Date().toISOString().slice(0, 10)
    assert.match(html, new RegExp(`<time dateTime="${today}T[^"]+">${today}</time>`))
    assert.match(html, /expires <time dateTime="2099-02-09T12:00:00.000Z" title="2099-02-09 12:00 UTC">2099-02-09<\/time>/)
    assert.doesNotMatch(html, /\d{1,2}\/\d{1,2}\/\d{4}/, 'no locale-formatted dates')
  })
})

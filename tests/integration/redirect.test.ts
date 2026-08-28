import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  client, createApiKey, createUser, ip, migrate, pool, query, resetDb, skip, startApp, type App,
} from './harness.ts'

describe('public redirects', { skip }, () => {
  let app: App
  let api: ReturnType<typeof client>
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
    api = client(app, await createApiKey(await createUser()))
  })

  const visit = (code: string, headers: Record<string, string> = {}) =>
    fetch(`${app.baseUrl}/${code}`, { redirect: 'manual', headers })

  const submitPassword = (code: string, password: string, fromIp: string) =>
    fetch(`${app.baseUrl}/${code}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': fromIp },
      body: new URLSearchParams({ password }),
    })

  test('redirects with 302 and records one click', async () => {
    const { body: link } = await api.create({ url: 'https://example.com/dest', code: 'go' })
    const res = await visit('go', { 'x-real-ip': ip(1), 'user-agent': 'Mozilla/5.0 Firefox/130.0' })
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('location'), 'https://example.com/dest')
    const [{ count }] = await query('select count(*)::int as count from clicks where link_id = $1', [link.id])
    assert.equal(count, 1)
  })

  test('the click cap holds under concurrent visits', async () => {
    const { body: link } = await api.create({ url: 'https://example.com/limited', code: 'cap', maxClicks: 10 })
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => visit('cap', { 'x-real-ip': ip(i) })),
    )
    const redirected = results.filter((r) => r.status === 302).length
    assert.equal(redirected, 10)

    const [row] = await query('select click_count from links where id = $1', [link.id])
    assert.equal(row.click_count, 10)
    const outcomes = await query(
      'select outcome, count(*)::int as count from clicks where link_id = $1 group by outcome order by outcome',
      [link.id],
    )
    assert.deepEqual(outcomes, [{ outcome: 'blocked', count: 30 }, { outcome: 'redirected', count: 10 }])
  })

  test('the correct password redirects and resets the failure counter', async () => {
    await api.create({ url: 'https://example.com/secret', code: 'pw', password: 'correct horse' })
    assert.equal((await submitPassword('pw', 'wrong', ip(1))).status, 401)
    const ok = await submitPassword('pw', 'correct horse', ip(1))
    assert.equal(ok.status, 302)
    assert.equal(ok.headers.get('location'), 'https://example.com/secret')
    assert.equal((await query(`select 1 from rate_limits where key like 'pw:%'`)).length, 0)
  })

  test('five failures lock the IP out, even with the right password', async () => {
    await api.create({ url: 'https://example.com/secret', code: 'pw', password: 'correct horse' })
    for (let i = 0; i < 5; i++) assert.equal((await submitPassword('pw', 'wrong', ip(1))).status, 401)
    assert.equal((await submitPassword('pw', 'correct horse', ip(1))).status, 429)
    // Other IPs are unaffected.
    assert.equal((await submitPassword('pw', 'correct horse', ip(2))).status, 302)
  })

  // Regression test for #8
  test('concurrent password guesses cannot exceed the lockout limit', async () => {
    await api.create({ url: 'https://example.com/secret', code: 'pw', password: 'correct horse' })
    const results = await Promise.all(
      Array.from({ length: 25 }, () => submitPassword('pw', 'wrong', ip(1))),
    )
    const verified = results.filter((r) => r.status === 401).length
    const locked = results.filter((r) => r.status === 429).length
    assert.ok(verified <= 5, `expected at most 5 password checks, got ${verified}`)
    assert.equal(verified + locked, 25)
  })

  test('privacy mode drops IP, city, and user agent but keeps aggregates', async () => {
    const { body: link } = await api.create({ url: 'https://example.com', code: 'priv', privacyEnabled: true })
    await visit('priv', {
      'x-real-ip': ip(1),
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36',
      'x-vercel-ip-country': 'DE',
      'x-vercel-ip-city': 'Berlin',
    })
    const [click] = await query('select * from clicks where link_id = $1', [link.id])
    assert.equal(click.ip, null)
    assert.equal(click.city, null)
    assert.equal(click.user_agent, null)
    assert.equal(click.country, 'DE')
    assert.equal(click.browser, 'Chrome')
    assert.ok(click.visitor_hash, 'unique-visitor hash is still recorded')
  })

  test('inactive links serve the fallback URL or an error page', async () => {
    await api.create({ url: 'https://example.com', code: 'off', status: 'paused' })
    await api.create({
      url: 'https://example.com', code: 'old',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      expiredRedirectUrl: 'https://example.com/ended',
    })
    assert.equal((await visit('off')).status, 403)
    const expired = await visit('old')
    assert.equal(expired.status, 302)
    assert.equal(expired.headers.get('location'), 'https://example.com/ended')
    assert.equal((await visit('missing')).status, 404)
  })

  // Regression tests for #36
  test('visits to inactive links are recorded by outcome without using up the click cap', async () => {
    const { body: fallback } = await api.create({
      url: 'https://example.com', code: 'ended', expiredRedirectUrl: 'https://example.com/ended',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    })
    const { body: paused } = await api.create({ url: 'https://example.com', code: 'held', status: 'paused' })
    await visit('ended', { 'x-real-ip': ip(1) })
    await visit('ended', { 'x-real-ip': ip(2), 'x-vercel-ip-country': 'NL' })
    await visit('held', { 'x-real-ip': ip(3) })

    // Sort in JS on both sides: Postgres collation orders random ids differently.
    const byText = (a: unknown[], b: unknown[]) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1
    const rows = await query('select link_id, outcome, country from clicks')
    assert.deepEqual(rows.map((r) => [r.link_id, r.outcome, r.country]).sort(byText), [
      [fallback.id, 'fallback', null],
      [fallback.id, 'fallback', 'NL'],
      [paused.id, 'blocked', null],
    ].sort(byText))
    const counts = await query('select click_count from links where id = any($1)', [[fallback.id, paused.id]])
    assert.ok(counts.every((r) => r.click_count === 0))

    const { body: stats } = await api.stats(fallback.id)
    assert.deepEqual(stats.outcomes, { redirected: 0, fallback: 2, blocked: 0, password_failed: 0 })
    assert.equal(stats.human + stats.bots, 0, 'breakdowns only count redirected visits')
    assert.deepEqual(stats.byCountry, [])
  })

  test('wrong passwords are recorded as password_failed', async () => {
    const { body: link } = await api.create({ url: 'https://example.com/secret', code: 'pw2', password: 'correct horse' })
    await submitPassword('pw2', 'wrong', ip(1))
    await submitPassword('pw2', 'correct horse', ip(1))
    const { body: stats } = await api.stats(link.id)
    assert.deepEqual(stats.outcomes, { redirected: 1, fallback: 0, blocked: 0, password_failed: 1 })
    assert.equal(stats.human + stats.bots, 1, 'only the redirect counts as a click')
  })
})

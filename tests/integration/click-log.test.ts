import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  client, createApiKey, createUser, migrate, pool, query, resetDb, sessionCookie, skip, startApp, type App,
} from './harness.ts'

// Regression tests for #19
describe('click log export and analytics labels', { skip }, () => {
  let app: App
  let ownerId: string
  let cookie: string
  let linkId: string
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
    const { body } = await client(app, await createApiKey(ownerId)).create({ url: 'https://example.com', code: 'logged' })
    linkId = body.id
  })

  /** `n` clicks sharing one timestamp, so paging must tie-break on id. */
  const addClicks = (n: number, fields: { country?: string | null; bot?: boolean; referrer?: string | null } = {}) =>
    query(
      `insert into clicks (id, link_id, timestamp, country, is_bot, referrer)
       select 'c' || $5 || '-' || i, $1, '2026-09-20 12:00:00.123456', $2, $3, $4 from generate_series(1, $6) i`,
      [linkId, fields.country ?? null, fields.bot ?? false, fields.referrer ?? null, Math.random().toString(36).slice(2), n],
    )

  const exportCsv = async (params = '', headers: Record<string, string> = { cookie }) => {
    const res = await fetch(`${app.baseUrl}/api/links/logged/clicks${params}`, { headers })
    return { status: res.status, headers: res.headers, lines: (await res.text()).trim().split('\n') }
  }

  test('exports every click across batches without repeats', async () => {
    await addClicks(1500, { country: 'DE' })
    await addClicks(700, { country: 'US', bot: true })
    const { status, headers, lines } = await exportCsv()
    assert.equal(status, 200)
    assert.match(headers.get('content-disposition') ?? '', /attachment; filename="logged-clicks-/)
    assert.equal(lines[0], 'timestamp,outcome,country,city,referrer,browser,os,device,bot,ip,user_agent')
    const rows = lines.slice(1)
    // A cursor that lost microseconds would repeat rows; one that ignored ids would skip them.
    assert.equal(rows.length, 2200)
    assert.equal(rows.filter((r) => r.includes(',DE,')).length, 1500)
  })

  test('export honours the humans-only and country filters', async () => {
    await addClicks(3, { country: 'DE' })
    await addClicks(2, { country: 'US', bot: true })
    await addClicks(4, { country: null })
    assert.equal((await exportCsv('?humansOnly=true')).lines.length - 1, 7)
    assert.equal((await exportCsv('?country=US')).lines.length - 1, 2)
    assert.equal((await exportCsv('?country=')).lines.length - 1, 4, 'empty country selects clicks without one')
  })

  test('export requires a session and ownership', async () => {
    await addClicks(1)
    assert.equal((await exportCsv('', {})).status, 401)
    const stranger = await sessionCookie(app, await createUser())
    assert.equal((await exportCsv('', { cookie: stranger })).status, 404)
  })

  test('the analytics page labels countries and direct traffic', async () => {
    await addClicks(2, { country: 'DE' })
    await addClicks(1, { country: 'US', referrer: 'news.example' })
    await query(`update clicks set timestamp = now() at time zone 'utc'`)
    const res = await fetch(`${app.baseUrl}/dashboard/links/logged`, { headers: { cookie } })
    assert.equal(res.status, 200)
    const html = await res.text()
    assert.match(html, /🇩🇪 Germany/)
    assert.match(html, /🇺🇸 United States/)
    assert.match(html, />Direct</)
    assert.doesNotMatch(html, />direct</)
    assert.match(html, /67%/, 'Germany share of 3 clicks')
  })
})

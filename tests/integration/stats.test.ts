import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  client, createApiKey, createUser, migrate, pool, query, resetDb, skip, startApp, type App,
} from './harness.ts'

const DAY = 24 * 60 * 60 * 1000

// Regression tests for #28: rolled-up stats must match stats computed from raw clicks.
describe('click stats rollups', { skip }, () => {
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

  type ClickFields = { country?: string; referrer?: string; bot?: boolean; visitor?: string; outcome?: string }
  const addClick = (linkId: string, daysAgo: number, c: ClickFields = {}) =>
    query(
      `insert into clicks (id, link_id, timestamp, country, browser, referrer, is_bot, visitor_hash, outcome)
       values ($1, $2, $3, $4, 'Firefox', $5, $6, $7, $8)`,
      [randomBytes(8).toString('hex'), linkId, new Date(Date.now() - daysAgo * DAY).toISOString(),
        c.country ?? null, c.referrer ?? null, c.bot ?? false, c.visitor ?? null, c.outcome ?? 'redirected'],
    )

  const runCron = async () => {
    const res = await fetch(`${app.baseUrl}/api/internal/cleanup`, { headers: { authorization: `Bearer ${app.cronSecret}` } })
    assert.equal(res.status, 200)
    return res.json() as Promise<{ rolledUp: number; deleted: { clicks: number } }>
  }

  const allStats = async (linkId: string) => {
    const out: Record<number, unknown> = {}
    for (const days of [1, 7, 30, 365]) out[days] = (await api.stats(linkId, days)).body
    return out
  }

  test('stats are identical before and after rolling up, and after re-running', async () => {
    const { body: link } = await api.create({ url: 'https://example.com', code: 'rolled' })
    const { body: other } = await api.create({ url: 'https://example.com', code: 'other' })
    for (const [daysAgo, c] of [
      [0, { country: 'US', visitor: 'a' }],
      [0, { country: 'US', visitor: 'a' }],
      [1, { country: 'DE', referrer: 'news.example', visitor: 'a' }],
      [1, { bot: true, visitor: 'bot' }],
      [3, { country: 'US', visitor: 'b' }],
      [3, { visitor: 'c' }],
      [3, { country: 'NL', visitor: 'e', outcome: 'fallback' }], // counted only in outcomes
      [20, { country: 'FR', referrer: 'news.example', visitor: 'b' }],
      [100, { country: 'JP', visitor: 'd' }], // past the 90-day retention default
      [400, { country: 'BR' }], // outside every range
    ] as const) await addClick(link.id, daysAgo, c)
    await addClick(other.id, 1, { country: 'CA' })

    const before = await allStats(link.id)
    assert.deepEqual((before[7] as { outcomes: unknown }).outcomes, { redirected: 6, fallback: 1, blocked: 0, password_failed: 0 })
    assert.ok(!(before[7] as { byCountry: { country: string }[] }).byCountry.some((c) => c.country === 'NL'))
    const first = await runCron()
    assert.ok(first.rolledUp > 0)
    assert.equal(first.deleted.clicks, 2, 'retention removed the 100- and 400-day-old clicks')

    const after = await allStats(link.id)
    // Unique visitors over a range come from raw clicks, so the 100-day-old
    // visitor drops out of the 365-day unique count once retention deletes it.
    ;(before[365] as { uniqueVisitors: number }).uniqueVisitors -= 1
    ;(before[365] as { byCountry: unknown[] }).byCountry = (before[365] as { byCountry: { country: string }[] })
      .byCountry.filter((c) => c.country !== 'BR')
    assert.deepEqual(after, before)

    assert.equal((await runCron()).rolledUp, 0, 'nothing new to roll up')
    assert.deepEqual(await allStats(link.id), after)

    const [{ count }] = await query(
      `select count(*)::int as count from click_daily where day >= (now() at time zone 'utc')::date`,
    )
    assert.equal(count, 0, "today isn't rolled up until it ends")
  })

  test('clicks after a rollup are still counted', async () => {
    const { body: link } = await api.create({ url: 'https://example.com', code: 'fresh' })
    await addClick(link.id, 2, { country: 'US' })
    await runCron()
    await addClick(link.id, 0, { country: 'US' })

    const { body } = await api.stats(link.id, 7)
    assert.equal(body.human, 2)
    assert.deepEqual(body.byCountry, [{ country: 'US', count: 2 }])
    assert.equal(body.series.at(-1).count, 1)
    assert.equal(body.series.at(-3).count, 1)
  })
})

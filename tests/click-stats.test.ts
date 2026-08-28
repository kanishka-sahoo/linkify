import assert from 'node:assert/strict'
import test from 'node:test'
import { fillDailySeries, seriesStart, summarizeClickStats, type StatsRow } from '../src/lib/click-stats.ts'

const now = new Date('2026-09-26T15:30:00Z')

test('seriesStart covers exactly `days` UTC calendar days', () => {
  assert.equal(seriesStart(1, now).toISOString(), '2026-09-26T00:00:00.000Z')
  assert.equal(seriesStart(30, now).toISOString(), '2026-08-28T00:00:00.000Z')
})

test('fillDailySeries returns one entry per day with zeros for gaps', () => {
  const since = seriesStart(30, now)
  const series = fillDailySeries([
    { day: '2026-09-10', count: 1, unique: 1 },
    { day: '2026-09-19', count: 1, unique: 0 },
    { day: '2026-09-26', count: 1, unique: 1 },
  ], since, now)

  assert.equal(series.length, 30)
  assert.equal(series[0].day, '2026-08-28')
  assert.equal(series.at(-1)?.day, '2026-09-26')
  assert.deepEqual(series.find((p) => p.day === '2026-09-11'), { day: '2026-09-11', count: 0, unique: 0 })
  assert.deepEqual(series.find((p) => p.day === '2026-09-19'), { day: '2026-09-19', count: 1, unique: 0 })
  assert.equal(series.reduce((sum, p) => sum + p.count, 0), 3)
})

test('fillDailySeries fills an empty range with zeros', () => {
  const series = fillDailySeries([], seriesStart(7, now), now)
  assert.equal(series.length, 7)
  assert.ok(series.every((p) => p.count === 0 && p.unique === 0))
})

test('summarizeClickStats builds the series from bot and unique rows', () => {
  const rows: StatsRow[] = [
    { day: '2026-09-24', dimension: 'bot', value: 'false', count: 3 },
    { day: '2026-09-24', dimension: 'bot', value: 'true', count: 1 },
    { day: '2026-09-24', dimension: 'unique', value: '', count: 2 },
    { day: '2026-09-26', dimension: 'bot', value: 'false', count: 5 },
    { day: '2026-09-26', dimension: 'unique', value: '', count: 4 },
  ]
  const stats = summarizeClickStats(rows, seriesStart(3, now), now)
  assert.deepEqual(stats.series, [
    { day: '2026-09-24', count: 4, unique: 2 },
    { day: '2026-09-25', count: 0, unique: 0 },
    { day: '2026-09-26', count: 5, unique: 4 },
  ])
  assert.equal(stats.human, 8)
  assert.equal(stats.bots, 1)
})

test('summarizeClickStats sums breakdowns across rows, sorts by count, and maps "" to null', () => {
  const rows: StatsRow[] = [
    { day: null, dimension: 'country', value: 'US', count: 2 },
    { day: null, dimension: 'country', value: '', count: 5 },
    { day: null, dimension: 'country', value: 'US', count: 4 },
    { day: null, dimension: 'referrer', value: 'news.example', count: 1 },
  ]
  const { breakdowns } = summarizeClickStats(rows, seriesStart(1, now), now)
  assert.deepEqual(breakdowns.country, [{ name: 'US', count: 6 }, { name: null, count: 5 }])
  assert.deepEqual(breakdowns.referrer, [{ name: 'news.example', count: 1 }])
  assert.deepEqual(breakdowns.browser, [])
})

test('summarizeClickStats totals outcomes separately from breakdowns', () => {
  const rows: StatsRow[] = [
    { day: null, dimension: 'outcome', value: 'redirected', count: 4 },
    { day: null, dimension: 'outcome', value: 'fallback', count: 2 },
    { day: null, dimension: 'outcome', value: 'password_failed', count: 1 },
    { day: '2026-09-26', dimension: 'bot', value: 'false', count: 4 },
  ]
  const stats = summarizeClickStats(rows, seriesStart(1, now), now)
  assert.deepEqual(stats.outcomes, { redirected: 4, fallback: 2, blocked: 0, password_failed: 1 })
  assert.equal(stats.human, 4)
})

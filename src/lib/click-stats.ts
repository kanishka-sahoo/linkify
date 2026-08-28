const DAY_MS = 24 * 60 * 60 * 1000

export interface DailyPoint {
  day: string
  count: number
  unique: number
}

/** Start of the UTC day `days - 1` days before `now`, so the window covers exactly `days` calendar days. */
export function seriesStart(days: number, now = new Date()): Date {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return new Date(today - (days - 1) * DAY_MS)
}

/** Returns one point per UTC day from `since` through `now`, filling days without clicks with zeros. */
export function fillDailySeries(rows: DailyPoint[], since: Date, now = new Date()): DailyPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, r]))
  const out: DailyPoint[] = []
  for (let t = seriesStart(1, since).getTime(); t <= now.getTime(); t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10)
    out.push(byDay.get(day) ?? { day, count: 0, unique: 0 })
  }
  return out
}

/**
 * What happened on a visit: `redirected` to the destination, sent to the
 * link's `fallback` URL or `blocked` because the link was inactive, or
 * `password_failed`.
 */
export const CLICK_OUTCOMES = ['redirected', 'fallback', 'blocked', 'password_failed'] as const
export type ClickOutcome = (typeof CLICK_OUTCOMES)[number]

/** Breakdown dimensions stored in `click_daily`. `bot` holds 'true' / 'false'. */
export type ClickDimension = 'country' | 'referrer' | 'browser' | 'os' | 'device' | 'bot'

/**
 * One aggregated row from the stats query. `day` is set for `bot` and
 * `unique` rows (needed for the daily series) and null otherwise.
 */
export type StatsRow = {
  day: string | null
  dimension: ClickDimension | 'outcome' | 'unique'
  value: string
  count: number
}

export interface NamedCount {
  name: string | null
  count: number
}

export interface ClickStats {
  series: DailyPoint[]
  breakdowns: Record<Exclude<ClickDimension, 'bot'>, NamedCount[]>
  human: number
  bots: number
  /** All visits in the range by outcome; breakdowns and the series only count `redirected`. */
  outcomes: Record<ClickOutcome, number>
}

/** Folds stats rows into a zero-filled daily series and per-dimension breakdowns sorted by count. */
export function summarizeClickStats(rows: StatsRow[], since: Date, now = new Date()): ClickStats {
  const days = new Map<string, DailyPoint>()
  const point = (day: string) => {
    let p = days.get(day)
    if (!p) days.set(day, (p = { day, count: 0, unique: 0 }))
    return p
  }
  const totals = new Map<string, Map<string, number>>()
  let human = 0
  let bots = 0
  const outcomes = Object.fromEntries(CLICK_OUTCOMES.map((o) => [o, 0])) as Record<ClickOutcome, number>

  for (const row of rows) {
    if (row.dimension === 'outcome') {
      if (row.value in outcomes) outcomes[row.value as ClickOutcome] += row.count
      continue
    }
    if (row.dimension === 'unique') {
      if (row.day) point(row.day).unique += row.count
      continue
    }
    if (row.dimension === 'bot') {
      if (row.value === 'true') bots += row.count
      else human += row.count
      if (row.day) point(row.day).count += row.count
      continue
    }
    const byValue = totals.get(row.dimension) ?? new Map<string, number>()
    byValue.set(row.value, (byValue.get(row.value) ?? 0) + row.count)
    totals.set(row.dimension, byValue)
  }

  const breakdown = (dimension: ClickDimension): NamedCount[] =>
    [...(totals.get(dimension) ?? [])]
      .map(([value, count]) => ({ name: value === '' ? null : value, count }))
      .sort((a, b) => b.count - a.count)

  return {
    series: fillDailySeries([...days.values()], since, now),
    breakdowns: {
      country: breakdown('country'),
      referrer: breakdown('referrer'),
      browser: breakdown('browser'),
      os: breakdown('os'),
      device: breakdown('device'),
    },
    human,
    bots,
    outcomes,
  }
}

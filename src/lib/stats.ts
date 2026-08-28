import { and, eq, gte, isNotNull, sql, type SQL } from 'drizzle-orm'
import { db } from './db'
import { clickDaily, clicks } from './schema'
import { seriesStart, summarizeClickStats, type StatsRow } from './click-stats'

/** First day not yet in `click_daily`; everything before it has been rolled up. */
const ROLLED_UNTIL = sql`(select coalesce(max(${clickDaily.day}) + 1, '-infinity'::date) from ${clickDaily})`

/**
 * Clicks matching `where`, aggregated into `click_daily` rows per link and UTC
 * day. Breakdowns and uniques count redirected clicks; `outcome` counts all.
 * Grouping sets and a two-level distinct both hash in one pass; a lateral
 * join per dimension and count(distinct) were 3x and 1.5x slower.
 */
function dailyRows(where: SQL) {
  return sql`
    select link_id, day,
      case
        when grouping(country) = 0 then 'country' when grouping(referrer) = 0 then 'referrer'
        when grouping(browser) = 0 then 'browser' when grouping(os) = 0 then 'os'
        when grouping(device_type) = 0 then 'device' else 'bot'
      end as dimension,
      coalesce(country, referrer, browser, os, device_type, is_bot::text, '') as value,
      count(*)::int as count
    from (
      select link_id, timestamp::date as day, country, referrer, browser, os, device_type, is_bot
      from ${clicks} where (${where}) and outcome = 'redirected'
    ) c
    group by grouping sets (
      (link_id, day, country), (link_id, day, referrer), (link_id, day, browser),
      (link_id, day, os), (link_id, day, device_type), (link_id, day, is_bot)
    )
    union all
    select link_id, day, 'unique', '', (count(*) filter (where human))::int
    from (
      select link_id, timestamp::date as day, visitor_hash, bool_or(not is_bot) as human
      from ${clicks} where (${where}) and outcome = 'redirected' and visitor_hash is not null
      group by 1, 2, 3
    ) v
    group by 1, 2
    union all
    select link_id, timestamp::date, 'outcome', outcome, count(*)::int
    from ${clicks} where (${where})
    group by 1, 2, 4`
}

/**
 * Rolls up every whole UTC day since the last run into `click_daily`.
 * One statement, so a failed run leaves nothing half-written, and the upsert
 * makes re-running harmless. Must run before retention deletes old clicks.
 */
export async function rollupClicks(now = new Date()) {
  const today = seriesStart(1, now).toISOString()
  const result = await db.execute(sql`
    insert into ${clickDaily} (link_id, day, dimension, value, count)
    select link_id, day, dimension, value, count
    from (${dailyRows(sql`${clicks.timestamp} >= ${ROLLED_UNTIL}::timestamp and ${clicks.timestamp} < ${today}::timestamp`)}) r
    on conflict (link_id, day, dimension, value) do update set count = excluded.count`)
  return result.rowCount ?? 0
}

/**
 * Click stats for one link over the last `days` UTC days: rolled-up days come
 * from `click_daily`, the rest from `clicks`. Unique visitors over the whole
 * range can't be summed from daily rows, so that count reads `clicks` directly.
 */
export async function getClickStats(linkId: string, days: number) {
  const since = seriesStart(days)
  const sinceDay = since.toISOString().slice(0, 10)

  // A distinct subquery hashes where count(distinct) sorts: ~2x faster on large ranges.
  const uniqueVisitors = db
    .select({ count: sql<number>`count(*)::int` })
    .from(
      db
        .selectDistinct({ visitorHash: clicks.visitorHash })
        .from(clicks)
        .where(and(
          eq(clicks.linkId, linkId), gte(clicks.timestamp, since), eq(clicks.outcome, 'redirected'),
          eq(clicks.isBot, false), isNotNull(clicks.visitorHash),
        ))
        .as('visitors'),
    )
    .then((r) => r[0]?.count ?? 0)

  // Read the boundary up front: as a subquery the planner can't estimate the
  // raw-clicks range, overestimates it ~100x, and spends ~0.5s JIT-compiling.
  const { rows: [{ rolledUntil }] } = await db.execute<{ rolledUntil: string | null }>(
    sql`select (max(${clickDaily.day}) + 1)::text as "rolledUntil" from ${clickDaily}`,
  )
  const rawFrom = rolledUntil && rolledUntil > sinceDay ? rolledUntil : sinceDay

  const { rows } = await db.execute<StatsRow>(sql`
    select case when dimension in ('bot', 'unique') then day::text end as day, dimension, value,
      sum(count)::int as count
    from (
      select day, dimension, value, count from ${clickDaily}
      where ${clickDaily.linkId} = ${linkId} and ${clickDaily.day} >= ${sinceDay}::date and ${clickDaily.day} < ${rawFrom}::date
      union all
      select day, dimension, value, count
      from (${dailyRows(sql`${clicks.linkId} = ${linkId} and ${clicks.timestamp} >= ${rawFrom}::timestamp`)}) raw
    ) r
    group by 1, 2, 3`)

  return { ...summarizeClickStats(rows, since), uniqueVisitors: await uniqueVisitors }
}

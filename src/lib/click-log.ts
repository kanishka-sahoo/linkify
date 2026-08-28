import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from './db'
import { clicks } from './schema'
import { csvCell } from './csv'

export interface ClickLogFilter {
  humansOnly?: boolean
  /** ISO country code, or '' for clicks without a country. */
  country?: string
}

/**
 * Position after the last click returned. `ts` is Postgres' text form of the
 * timestamp: JS Dates drop microseconds, which would repeat or skip rows.
 */
export interface ClickLogCursor {
  ts: string
  id: string
}

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/

export function parseClickLogFilter(value: { humansOnly?: unknown; country?: unknown }): ClickLogFilter {
  return {
    humansOnly: value.humansOnly === true || value.humansOnly === 'true' || undefined,
    country: typeof value.country === 'string' && /^[A-Za-z]{0,8}$/.test(value.country) ? value.country : undefined,
  }
}

export function parseClickLogCursor(value: unknown): ClickLogCursor | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { ts, id } = value as Record<string, unknown>
  if (typeof ts !== 'string' || !TIMESTAMP_RE.test(ts) || typeof id !== 'string' || id.length > 64) return undefined
  return { ts, id }
}

/** One page of a link's clicks, newest first, plus the cursor for the next page (null at the end). */
export async function queryClickLog(linkId: string, filter: ClickLogFilter, cursor: ClickLogCursor | undefined, limit: number) {
  const rows = await db
    .select({ click: clicks, cursorTs: sql<string>`${clicks.timestamp}::text` })
    .from(clicks)
    .where(and(
      eq(clicks.linkId, linkId),
      filter.humansOnly ? eq(clicks.isBot, false) : undefined,
      filter.country === '' ? isNull(clicks.country) : filter.country ? eq(clicks.country, filter.country) : undefined,
      cursor ? sql`(${clicks.timestamp}, ${clicks.id}) < (${cursor.ts}::timestamp, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(clicks.timestamp), desc(clicks.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    clicks: page.map((r) => r.click),
    nextCursor: rows.length > limit && last ? { ts: last.cursorTs, id: last.click.id } : null,
  }
}

const CSV_COLUMNS = [
  'timestamp', 'outcome', 'country', 'city', 'referrer', 'browser', 'os', 'device', 'bot', 'ip', 'user_agent',
] as const

/** Streams the whole filtered click log as CSV, reading it in batches. */
export function clickLogCsv(linkId: string, filter: ClickLogFilter) {
  const encoder = new TextEncoder()
  let cursor: ClickLogCursor | undefined
  let started = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true
        controller.enqueue(encoder.encode(`${CSV_COLUMNS.join(',')}\n`))
      }
      const page = await queryClickLog(linkId, filter, cursor, 1000)
      const lines = page.clicks.map((c) => [
        c.timestamp.toISOString(), c.outcome, c.country, c.city, c.referrer, c.browser, c.os, c.deviceType,
        c.isBot, c.ip, c.userAgent,
      ].map(csvCell).join(','))
      if (lines.length > 0) controller.enqueue(encoder.encode(`${lines.join('\n')}\n`))
      if (!page.nextCursor) controller.close()
      else cursor = page.nextCursor
    },
  })
}

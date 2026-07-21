import { eq, sql } from 'drizzle-orm'
import { db } from './db'
import { rateLimits } from './schema'

export interface LimitResult {
  allowed: boolean
  /** Seconds until the current window closes (0 when allowed). */
  retryAfterSec: number
}

/**
 * Fixed-window rate limiter backed by the rate_limits table, so limits hold
 * across serverless instances. Each hit increments the counter; once `limit`
 * is reached within `windowMs`, further hits are rejected until the window ends.
 */
export async function hitLimit(key: string, limit: number, windowMs: number): Promise<LimitResult> {
  const now = new Date()
  const newReset = new Date(now.getTime() + windowMs)
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt: newReset })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.resetAt} < now() then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql`case when ${rateLimits.resetAt} < now() then ${newReset} else ${rateLimits.resetAt} end`,
      },
    })
    .returning({ count: rateLimits.count, resetAt: rateLimits.resetAt })

  const allowed = row.count <= limit
  return {
    allowed,
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000)),
  }
}

/** Clear a limiter's counter — e.g. after a successful password entry. */
export async function resetLimit(key: string) {
  await db.delete(rateLimits).where(eq(rateLimits.key, key))
}

/** Read-only check: is this key already at/over `limit` within its window? */
export async function checkLimit(key: string, limit: number): Promise<LimitResult> {
  const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key))
  if (!row || row.resetAt < new Date()) return { allowed: true, retryAfterSec: 0 }
  const allowed = row.count < limit
  return {
    allowed,
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000)),
  }
}

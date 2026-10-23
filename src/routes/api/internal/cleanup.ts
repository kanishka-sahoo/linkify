import { createHash, timingSafeEqual } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { and, eq, lt, notExists } from 'drizzle-orm'
import { db } from '~/lib/db'
import {
  apiKeys, auditLogs, authRateLimit, clicks, oauthClients, oauthCodes, oauthGrants, rateLimits,
} from '~/lib/schema'
import { rollupClicks } from '~/lib/stats'

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!expected || expected.length < 32 || !provided) return false
  return timingSafeEqual(
    createHash('sha256').update(expected).digest(),
    createHash('sha256').update(provided).digest(),
  )
}

function retentionDays(name: string, fallback: number, max: number) {
  const parsed = Number(process.env[name] ?? fallback)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback
}

export const Route = createFileRoute('/api/internal/cleanup')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorized(request)) return new Response('Unauthorized', { status: 401 })
        const now = new Date()
        const analyticsCutoff = new Date(now.getTime() - retentionDays('ANALYTICS_RETENTION_DAYS', 90, 3650) * 86_400_000)
        const auditCutoff = new Date(now.getTime() - retentionDays('AUDIT_RETENTION_DAYS', 365, 3650) * 86_400_000)
        const authLimitCutoff = Date.now() - 2 * 86_400_000

        // Roll up first: retention is about to delete the oldest raw clicks.
        const rolledUp = await rollupClicks(now)
        const [oldClicks, oldAudits, oldLimits, oldAuthLimits, expiredKeys] = await Promise.all([
          db.delete(clicks).where(lt(clicks.timestamp, analyticsCutoff)).returning({ id: clicks.id }),
          db.delete(auditLogs).where(lt(auditLogs.createdAt, auditCutoff)).returning({ id: auditLogs.id }),
          db.delete(rateLimits).where(lt(rateLimits.resetAt, now)).returning({ key: rateLimits.key }),
          db.delete(authRateLimit).where(lt(authRateLimit.lastRequest, authLimitCutoff)).returning({ id: authRateLimit.id }),
          db.delete(apiKeys).where(lt(apiKeys.expiresAt, now)).returning({ id: apiKeys.id }),
        ])
        const [, lapsedGrants] = await Promise.all([
          db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, now)),
          db.delete(oauthGrants).where(lt(oauthGrants.refreshExpiresAt, now)).returning({ id: oauthGrants.id }),
        ])
        // Registration is open, so forget clients nobody connected within a day.
        const unusedClients = await db
          .delete(oauthClients)
          .where(and(
            lt(oauthClients.createdAt, new Date(now.getTime() - 86_400_000)),
            notExists(db.select().from(oauthGrants).where(eq(oauthGrants.clientId, oauthClients.id))),
            notExists(db.select().from(oauthCodes).where(eq(oauthCodes.clientId, oauthClients.id))),
          ))
          .returning({ id: oauthClients.id })

        return Response.json(
          {
            rolledUp,
            deleted: {
              clicks: oldClicks.length,
              auditLogs: oldAudits.length,
              rateLimits: oldLimits.length,
              authRateLimits: oldAuthLimits.length,
              apiKeys: expiredKeys.length,
              oauthGrants: lapsedGrants.length,
              oauthClients: unusedClients.length,
            },
          },
          { headers: { 'cache-control': 'no-store' } },
        )
      },
    },
  },
})

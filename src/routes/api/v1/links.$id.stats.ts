import { createFileRoute } from '@tanstack/react-router'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '~/lib/db'
import { clicks, links } from '~/lib/schema'
import { resolveApiKey } from '~/lib/keys'
import { ownedByClause } from '~/lib/links'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/v1/links/$id/stats')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const key = await resolveApiKey(request)
        if (!key) return json({ error: 'Unauthorized' }, 401)
        const owned = ownedByClause({ id: key.userId, role: key.role })
        const [link] = await db
          .select()
          .from(links)
          .where(owned ? and(eq(links.id, params.id), owned) : eq(links.id, params.id))
        if (!link) return json({ error: 'Not found' }, 404)

        const url = new URL(request.url)
        const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 30) || 30, 1), 365)
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        const scope = and(eq(clicks.linkId, link.id), gte(clicks.timestamp, since))

        const [series, byCountry, byReferrer, botSplit] = await Promise.all([
          db
            .select({
              day: sql<string>`to_char(date_trunc('day', ${clicks.timestamp}), 'YYYY-MM-DD')`,
              count: sql<number>`count(*)::int`,
            })
            .from(clicks)
            .where(scope)
            .groupBy(sql`date_trunc('day', ${clicks.timestamp})`)
            .orderBy(sql`date_trunc('day', ${clicks.timestamp})`),
          db
            .select({ country: clicks.country, count: sql<number>`count(*)::int` })
            .from(clicks)
            .where(scope)
            .groupBy(clicks.country)
            .orderBy(desc(sql`count(*)`))
            .limit(20),
          db
            .select({ referrer: clicks.referrer, count: sql<number>`count(*)::int` })
            .from(clicks)
            .where(scope)
            .groupBy(clicks.referrer)
            .orderBy(desc(sql`count(*)`))
            .limit(20),
          db
            .select({ isBot: clicks.isBot, count: sql<number>`count(*)::int` })
            .from(clicks)
            .where(scope)
            .groupBy(clicks.isBot),
        ])

        return json({
          code: link.code,
          days,
          totalClicks: link.clickCount,
          human: botSplit.find((b) => !b.isBot)?.count ?? 0,
          bots: botSplit.find((b) => b.isBot)?.count ?? 0,
          series,
          byCountry,
          byReferrer,
        })
      },
    },
  },
})

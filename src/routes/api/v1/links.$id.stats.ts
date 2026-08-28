import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { db } from '~/lib/db'
import { links } from '~/lib/schema'
import { resolveApiKey, hasApiScope } from '~/lib/keys'
import { ownedByClause } from '~/lib/links'
import { getClickStats } from '~/lib/stats'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

export const Route = createFileRoute('/api/v1/links/$id/stats')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const key = await resolveApiKey(request)
        if (!key) return json({ error: 'Unauthorized' }, 401)
        if (!hasApiScope(key, 'stats:read')) return json({ error: 'Forbidden' }, 403)
        const owned = ownedByClause({ id: key.userId, role: key.role })
        const [link] = await db
          .select()
          .from(links)
          .where(owned ? and(eq(links.id, params.id), owned) : eq(links.id, params.id))
        if (!link) return json({ error: 'Not found' }, 404)

        const url = new URL(request.url)
        const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 30) || 30, 1), 365)
        const stats = await getClickStats(link.id, days)

        return json({
          code: link.code,
          days,
          totalClicks: link.clickCount,
          human: stats.human,
          bots: stats.bots,
          uniqueVisitors: stats.uniqueVisitors,
          outcomes: stats.outcomes,
          series: stats.series,
          byCountry: stats.breakdowns.country.slice(0, 20).map(({ name, count }) => ({ country: name, count })),
          byReferrer: stats.breakdowns.referrer.slice(0, 20).map(({ name, count }) => ({ referrer: name, count })),
        })
      },
    },
  },
})

import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { auth } from '~/lib/auth'
import { accountRestriction } from '~/lib/account-policy'
import { clickLogCsv, parseClickLogFilter } from '~/lib/click-log'
import { db } from '~/lib/db'
import { links } from '~/lib/schema'
import { ownedByClause, validateCode } from '~/lib/links'

/** CSV download of a link's click log for the signed-in owner (or an admin). */
export const Route = createFileRoute('/api/links/$code/clicks')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session) return new Response('Unauthorized', { status: 401 })
        const restriction = accountRestriction(session.user)
        if (restriction) return new Response(restriction, { status: 403 })
        let code: string
        try {
          code = validateCode(params.code)
        } catch {
          return new Response('Not found', { status: 404 })
        }
        const owned = ownedByClause(session.user)
        const [link] = await db
          .select({ id: links.id })
          .from(links)
          .where(owned ? and(eq(links.code, code), owned) : eq(links.code, code))
        if (!link) return new Response('Not found', { status: 404 })

        const url = new URL(request.url)
        const filter = parseClickLogFilter(Object.fromEntries(url.searchParams))
        const filename = `${code}-clicks-${new Date().toISOString().slice(0, 10)}.csv`
        return new Response(clickLogCsv(link.id, filter), {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="${filename}"`,
            'cache-control': 'private, no-store',
            'x-content-type-options': 'nosniff',
          },
        })
      },
    },
  },
})

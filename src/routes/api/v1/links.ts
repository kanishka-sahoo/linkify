import { createFileRoute } from '@tanstack/react-router'
import { desc } from 'drizzle-orm'
import { db } from '~/lib/db'
import { links } from '~/lib/schema'
import { resolveApiKey, hasApiScope } from '~/lib/keys'
import { ownedByClause, safeLink } from '~/lib/links'
import { createLinkAs } from '~/lib/link-service'
import { BodyTooLargeError, readJsonLimited } from '~/lib/http'
import { json, linkErrorResponse } from '~/lib/api-response'

const MAX_JSON_BYTES = 64 * 1024

export const Route = createFileRoute('/api/v1/links')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = await resolveApiKey(request)
        if (!key) return json({ error: 'Unauthorized' }, 401)
        if (!hasApiScope(key, 'links:read')) return json({ error: 'Forbidden' }, 403)
        const rows = await db
          .select()
          .from(links)
          .where(ownedByClause({ id: key.userId, role: key.role }))
          .orderBy(desc(links.createdAt))
        return json({
          links: rows.map(safeLink),
        })
      },
      POST: async ({ request }) => {
        const key = await resolveApiKey(request)
        if (!key) return json({ error: 'Unauthorized' }, 401)
        if (!hasApiScope(key, 'links:write')) return json({ error: 'Forbidden' }, 403)
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
          return json({ error: 'Content-Type must be application/json' }, 415)
        }
        let input: unknown
        try {
          input = await readJsonLimited(request, MAX_JSON_BYTES)
        } catch (err) {
          if (err instanceof BodyTooLargeError) return json({ error: 'Request body too large' }, 413)
          return json({ error: 'Invalid JSON body' }, 400)
        }
        try {
          const link = await createLinkAs({ id: key.userId, role: key.role }, input, {
            via: 'api', keyId: key.id, headers: request.headers,
          })
          return json(link, 201)
        } catch (err) {
          return linkErrorResponse(err)
        }
      },
    },
  },
})

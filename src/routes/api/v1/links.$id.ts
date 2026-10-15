import { createFileRoute } from '@tanstack/react-router'
import { db } from '~/lib/db'
import { links } from '~/lib/schema'
import { resolveApiKey, hasApiScope } from '~/lib/keys'
import { safeLink } from '~/lib/links'
import { accessibleById, deleteLinkAs, updateLinkAs } from '~/lib/link-service'
import { BodyTooLargeError, readJsonLimited } from '~/lib/http'
import { json, linkErrorResponse } from '~/lib/api-response'

const MAX_JSON_BYTES = 64 * 1024

export const Route = createFileRoute('/api/v1/links/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const key = await resolveApiKey(request)
        if (!key) return json({ error: 'Unauthorized' }, 401)
        if (!hasApiScope(key, 'links:read')) return json({ error: 'Forbidden' }, 403)
        const [row] = await db.select().from(links).where(accessibleById(params.id, { id: key.userId, role: key.role }))
        if (!row) return json({ error: 'Not found' }, 404)
        return json(safeLink(row))
      },
      PATCH: async ({ request, params }) => {
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
          const link = await updateLinkAs({ id: key.userId, role: key.role }, params.id, input, {
            via: 'api', keyId: key.id, headers: request.headers,
          })
          return json(link)
        } catch (err) {
          return linkErrorResponse(err)
        }
      },
      DELETE: async ({ request, params }) => {
        const key = await resolveApiKey(request)
        if (!key) return json({ error: 'Unauthorized' }, 401)
        if (!hasApiScope(key, 'links:write')) return json({ error: 'Forbidden' }, 403)
        try {
          return json(await deleteLinkAs({ id: key.userId, role: key.role }, params.id, {
            via: 'api', keyId: key.id, headers: request.headers,
          }))
        } catch (err) {
          return linkErrorResponse(err)
        }
      },
    },
  },
})

import { createFileRoute } from '@tanstack/react-router'
import { nanoid } from 'nanoid'
import { desc, eq } from 'drizzle-orm'
import { db } from '~/lib/db'
import { links } from '~/lib/schema'
import { resolveApiKey, hashPassword, hasApiScope } from '~/lib/keys'
import { parseLinkInput, ownedByClause, safeLink } from '~/lib/links'
import { hitLimit } from '~/lib/ratelimit'
import { auditEvent } from '~/lib/audit'
import { BodyTooLargeError, readJsonLimited } from '~/lib/http'

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  })
}

const CREATE_LIMIT = 30
const CREATE_WINDOW_MS = 60 * 60 * 1000
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
        let body: ReturnType<typeof parseLinkInput>
        try {
          body = parseLinkInput(await readJsonLimited(request, MAX_JSON_BYTES))
        } catch (err) {
          if (err instanceof BodyTooLargeError) return json({ error: 'Request body too large' }, 413)
          return json({ error: err instanceof Error ? err.message : 'Invalid JSON body' }, 400)
        }
        const code = body.code ?? nanoid(7)
        const [existing] = await db.select({ id: links.id }).from(links).where(eq(links.code, code))
        if (existing) return json({ error: `code "${code}" is already taken` }, 409)

        const { allowed, retryAfterSec } = await hitLimit(`create:${key.userId}`, CREATE_LIMIT, CREATE_WINDOW_MS)
        if (!allowed) {
          return json({ error: 'Rate limit reached — link creation is capped at 30/hour' }, 429, {
            'retry-after': String(retryAfterSec),
          })
        }

        const [row] = await db
          .insert(links)
          .values({
            id: nanoid(),
            code,
            url: body.url,
            title: body.title ?? null,
            tags: body.tags ?? [],
            status: body.status ?? 'active',
            startsAt: body.startsAt ? new Date(body.startsAt) : null,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
            expiredRedirectUrl: body.expiredRedirectUrl ?? null,
            maxClicks: body.maxClicks ?? null,
            privacyEnabled: body.privacyEnabled ?? false,
            passwordHash: body.password ? hashPassword(body.password) : null,
            userId: key.userId,
          })
          .returning()
        await auditEvent({
          action: 'api.link.created', actorUserId: key.userId, targetType: 'link', targetId: row.id,
          headers: request.headers, metadata: { keyId: key.id },
        })
        return json(safeLink(row), 201)
      },
    },
  },
})

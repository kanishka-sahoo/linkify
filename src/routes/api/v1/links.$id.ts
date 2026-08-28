import { createFileRoute } from '@tanstack/react-router'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/lib/db'
import { clicks, links } from '~/lib/schema'
import { resolveApiKey, hashPassword, hasApiScope } from '~/lib/keys'
import { parseLinkInput, ownedByClause, safeLink } from '~/lib/links'
import { auditEvent } from '~/lib/audit'
import { BodyTooLargeError, readJsonLimited } from '~/lib/http'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

const MAX_JSON_BYTES = 64 * 1024

/** WHERE clause matching this id only if the key's owner may access it. */
function accessible(id: string, key: { userId: string; role: string }) {
  const owned = ownedByClause({ id: key.userId, role: key.role })
  return owned ? and(eq(links.id, id), owned) : eq(links.id, id)
}

export const Route = createFileRoute('/api/v1/links/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const key = await resolveApiKey(request)
        if (!key) return json({ error: 'Unauthorized' }, 401)
        if (!hasApiScope(key, 'links:read')) return json({ error: 'Forbidden' }, 403)
        const [row] = await db.select().from(links).where(accessible(params.id, key))
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
        let raw: Record<string, unknown>
        let body: ReturnType<typeof parseLinkInput>
        try {
          raw = await readJsonLimited(request, MAX_JSON_BYTES) as Record<string, unknown>
          body = parseLinkInput(raw, true)
        } catch (err) {
          if (err instanceof BodyTooLargeError) return json({ error: 'Request body too large' }, 413)
          return json({ error: err instanceof Error ? err.message : 'Invalid JSON body' }, 400)
        }
        if (body.code) {
          const [conflict] = await db
            .select({ id: links.id })
            .from(links)
            .where(and(eq(links.code, body.code), sql`${links.id} != ${params.id}`))
          if (conflict) return json({ error: `code "${body.code}" is already taken` }, 409)
        }
        const [current] = await db.select().from(links).where(accessible(params.id, key))
        if (!current) return json({ error: 'Not found' }, 404)
        const startsAt = Object.hasOwn(raw, 'startsAt')
          ? body.startsAt ? new Date(body.startsAt) : null
          : current.startsAt
        const expiresAt = Object.hasOwn(raw, 'expiresAt')
          ? body.expiresAt ? new Date(body.expiresAt) : null
          : current.expiresAt
        if (startsAt && expiresAt && startsAt >= expiresAt) {
          return json({ error: 'Expiry must be after the scheduled start' }, 400)
        }
        const [row] = await db
          .update(links)
          .set({
            ...(Object.hasOwn(raw, 'url') ? { url: body.url } : {}),
            ...(Object.hasOwn(raw, 'code') ? { code: body.code } : {}),
            ...(Object.hasOwn(raw, 'title') ? { title: body.title ?? null } : {}),
            ...(Object.hasOwn(raw, 'tags') ? { tags: body.tags ?? [] } : {}),
            ...(Object.hasOwn(raw, 'status') ? { status: body.status } : {}),
            ...(Object.hasOwn(raw, 'startsAt') ? { startsAt } : {}),
            ...(Object.hasOwn(raw, 'expiresAt')
              ? { expiresAt }
              : {}),
            ...(Object.hasOwn(raw, 'expiredRedirectUrl')
              ? { expiredRedirectUrl: body.expiredRedirectUrl ?? null }
              : {}),
            ...(Object.hasOwn(raw, 'maxClicks') ? { maxClicks: body.maxClicks ?? null } : {}),
            ...(Object.hasOwn(raw, 'privacyEnabled') ? { privacyEnabled: body.privacyEnabled ?? false } : {}),
            ...(Object.hasOwn(raw, 'password')
              ? { passwordHash: body.password ? hashPassword(body.password) : null }
              : {}),
            updatedAt: new Date(),
          })
          .where(accessible(params.id, key))
          .returning()
        if (!row) return json({ error: 'Not found' }, 404)
        if (row.privacyEnabled && Object.hasOwn(raw, 'privacyEnabled')) {
          await db.update(clicks)
            .set({ ip: null, city: null, userAgent: null })
            .where(eq(clicks.linkId, row.id))
        }
        await auditEvent({
          action: 'api.link.updated', actorUserId: key.userId, targetType: 'link', targetId: row.id,
          headers: request.headers, metadata: { keyId: key.id },
        })
        return json(safeLink(row))
      },
      DELETE: async ({ request, params }) => {
        const key = await resolveApiKey(request)
        if (!key) return json({ error: 'Unauthorized' }, 401)
        if (!hasApiScope(key, 'links:write')) return json({ error: 'Forbidden' }, 403)
        const [row] = await db
          .delete(links)
          .where(accessible(params.id, key))
          .returning({ id: links.id })
        if (!row) return json({ error: 'Not found' }, 404)
        await auditEvent({
          action: 'api.link.deleted', actorUserId: key.userId, targetType: 'link', targetId: row.id,
          headers: request.headers, metadata: { keyId: key.id },
        })
        return json({ ok: true })
      },
    },
  },
})

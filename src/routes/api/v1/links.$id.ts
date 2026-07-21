import { createFileRoute } from '@tanstack/react-router'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/lib/db'
import { links } from '~/lib/schema'
import { resolveApiKey, hashPassword } from '~/lib/keys'
import { normalizeTags, ownedByClause } from '~/lib/links'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const strip = (row: typeof links.$inferSelect) => {
  const { passwordHash, ...rest } = row
  return { ...rest, passwordProtected: Boolean(passwordHash) }
}

/** WHERE clause matching this id only if the key's owner may access it. */
function accessible(id: string, key: { userId: string | null; role: string }) {
  const owned = ownedByClause({ id: key.userId, role: key.role })
  return owned ? and(eq(links.id, id), owned) : eq(links.id, id)
}

export const Route = createFileRoute('/api/v1/links/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const key = await resolveApiKey(request)
        if (!key) return json({ error: 'Unauthorized' }, 401)
        const [row] = await db.select().from(links).where(accessible(params.id, key))
        if (!row) return json({ error: 'Not found' }, 404)
        return json(strip(row))
      },
      PATCH: async ({ request, params }) => {
        const key = await resolveApiKey(request)
        if (!key) return json({ error: 'Unauthorized' }, 401)
        let body: {
          url?: string
          code?: string
          title?: string | null
          tags?: string[] | null
          expiresAt?: string | null
          password?: string | null
        }
        try {
          body = await request.json()
        } catch {
          return json({ error: 'Invalid JSON body' }, 400)
        }
        if (body.tags !== undefined && body.tags !== null && !Array.isArray(body.tags)) {
          return json({ error: 'tags must be an array of strings' }, 400)
        }
        let tags: string[] | undefined
        try {
          tags = body.tags !== undefined ? normalizeTags(body.tags) : undefined
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : 'invalid tags' }, 400)
        }
        if (body.code) {
          const [conflict] = await db
            .select({ id: links.id })
            .from(links)
            .where(and(eq(links.code, body.code), sql`${links.id} != ${params.id}`))
          if (conflict) return json({ error: `code "${body.code}" is already taken` }, 409)
        }
        const [row] = await db
          .update(links)
          .set({
            ...(body.url !== undefined ? { url: body.url } : {}),
            ...(body.code !== undefined ? { code: body.code } : {}),
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(tags !== undefined ? { tags } : {}),
            ...(body.expiresAt !== undefined
              ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
              : {}),
            ...(body.password !== undefined
              ? { passwordHash: body.password ? hashPassword(body.password) : null }
              : {}),
            updatedAt: new Date(),
          })
          .where(accessible(params.id, key))
          .returning()
        if (!row) return json({ error: 'Not found' }, 404)
        return json(strip(row))
      },
      DELETE: async ({ request, params }) => {
        const key = await resolveApiKey(request)
        if (!key) return json({ error: 'Unauthorized' }, 401)
        const [row] = await db
          .delete(links)
          .where(accessible(params.id, key))
          .returning({ id: links.id })
        if (!row) return json({ error: 'Not found' }, 404)
        return json({ ok: true })
      },
    },
  },
})

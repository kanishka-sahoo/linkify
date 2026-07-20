import { createFileRoute } from '@tanstack/react-router'
import { nanoid } from 'nanoid'
import { desc, eq } from 'drizzle-orm'
import { db } from '~/lib/db'
import { links } from '~/lib/schema'
import { resolveApiKey, hashPassword } from '~/lib/keys'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const CODE_RE = /^[a-zA-Z0-9_-]{1,64}$/

export const Route = createFileRoute('/api/v1/links')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await resolveApiKey(request))) return json({ error: 'Unauthorized' }, 401)
        const rows = await db.select().from(links).orderBy(desc(links.createdAt))
        return json({
          links: rows.map(({ passwordHash, ...l }) => ({
            ...l,
            passwordProtected: Boolean(passwordHash),
          })),
        })
      },
      POST: async ({ request }) => {
        if (!(await resolveApiKey(request))) return json({ error: 'Unauthorized' }, 401)
        let body: {
          url?: string
          code?: string
          title?: string
          expiresAt?: string
          password?: string
        }
        try {
          body = await request.json()
        } catch {
          return json({ error: 'Invalid JSON body' }, 400)
        }
        if (!body.url) return json({ error: 'url is required' }, 400)
        try {
          const u = new URL(body.url)
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error()
        } catch {
          return json({ error: 'url must be a valid http(s) URL' }, 400)
        }
        const code = body.code ?? nanoid(7)
        if (!CODE_RE.test(code)) return json({ error: 'invalid code' }, 400)
        const [existing] = await db.select({ id: links.id }).from(links).where(eq(links.code, code))
        if (existing) return json({ error: `code "${code}" is already taken` }, 409)

        const [row] = await db
          .insert(links)
          .values({
            id: nanoid(),
            code,
            url: body.url,
            title: body.title ?? null,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
            passwordHash: body.password ? hashPassword(body.password) : null,
          })
          .returning()
        const { passwordHash, ...rest } = row
        return json({ ...rest, passwordProtected: Boolean(passwordHash) }, 201)
      },
    },
  },
})

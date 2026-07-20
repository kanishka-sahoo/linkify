import { createFileRoute } from '@tanstack/react-router'
import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '~/lib/db'
import { clicks, links } from '~/lib/schema'
import { extractClickMeta } from '~/lib/analytics'
import { verifyPassword } from '~/lib/keys'

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Linkify</title>
<style>
  :root { color-scheme: dark }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #0a0a0a; color: #fafafa; font-family: system-ui, sans-serif }
  .card { width: 100%; max-width: 22rem; padding: 2rem; text-align: center }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem }
  p { color: #a1a1aa; margin: 0 0 1.5rem; font-size: .925rem }
  form { display: flex; flex-direction: column; gap: .75rem }
  input { padding: .6rem .8rem; border-radius: .5rem; border: 1px solid #27272a; background: #18181b; color: #fafafa; font-size: 1rem; outline: none }
  input:focus { border-color: #52525b }
  button { padding: .6rem; border-radius: .5rem; border: 0; background: #fafafa; color: #0a0a0a; font-weight: 600; font-size: 1rem; cursor: pointer }
  button:hover { background: #d4d4d8 }
  .err { color: #f87171; font-size: .85rem; margin: 0 }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

function redirectResponse(url: string) {
  return new Response(null, {
    status: 302,
    headers: {
      location: url,
      // Never let intermediaries cache a redirect — analytics must see every hit.
      'cache-control': 'private, no-cache, no-store, must-revalidate',
    },
  })
}

async function recordClick(linkId: string, request: Request) {
  const meta = extractClickMeta(request)
  try {
    await db.insert(clicks).values({ id: nanoid(), linkId, ...meta })
    await db
      .update(links)
      .set({ clickCount: sql`${links.clickCount} + 1` })
      .where(eq(links.id, linkId))
  } catch (err) {
    // Analytics must never break a redirect.
    console.error('click capture failed', err)
  }
}

const passwordForm = (code: string, error = false) =>
  page(
    'Protected link',
    `<h1>Protected link</h1>
     <p>This link requires a password to continue.</p>
     ${error ? '<p class="err">Incorrect password, try again.</p>' : ''}
     <form method="POST" action="/${code}">
       <input type="password" name="password" placeholder="Password" autofocus required />
       <button type="submit">Continue</button>
     </form>`,
    error ? 401 : 200,
  )

async function resolve(code: string) {
  const [link] = await db.select().from(links).where(eq(links.code, code))
  return link ?? null
}

export const Route = createFileRoute('/$code')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const link = await resolve(params.code)
        if (!link) {
          return page('Not found', '<h1>404</h1><p>This link doesn\'t exist or was deleted.</p>', 404)
        }
        if (link.expiresAt && link.expiresAt < new Date()) {
          return page('Expired', '<h1>Link expired</h1><p>This short link is no longer active.</p>', 410)
        }
        if (link.passwordHash) {
          return passwordForm(link.code)
        }
        await recordClick(link.id, request)
        return redirectResponse(link.url)
      },
      POST: async ({ request, params }) => {
        const link = await resolve(params.code)
        if (!link) {
          return page('Not found', '<h1>404</h1><p>This link doesn\'t exist or was deleted.</p>', 404)
        }
        if (link.expiresAt && link.expiresAt < new Date()) {
          return page('Expired', '<h1>Link expired</h1><p>This short link is no longer active.</p>', 410)
        }
        const form = await request.formData()
        const password = String(form.get('password') ?? '')
        if (!link.passwordHash || !verifyPassword(password, link.passwordHash)) {
          return passwordForm(link.code, true)
        }
        await recordClick(link.id, request)
        return redirectResponse(link.url)
      },
    },
  },
})

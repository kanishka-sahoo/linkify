import { createFileRoute } from '@tanstack/react-router'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '~/lib/db'
import { clicks, links } from '~/lib/schema'
import { extractClickMeta } from '~/lib/analytics'
import { clientIp, sha256, verifyPassword } from '~/lib/keys'
import { hitLimit, resetLimit } from '~/lib/ratelimit'
import { BodyTooLargeError, readBodyLimited } from '~/lib/http'
import { getLinkAvailability } from '~/lib/link-domain'
import type { ClickOutcome } from '~/lib/click-stats'

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
    {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
    },
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

async function recordClick(link: typeof links.$inferSelect, request: Request) {
  const meta = extractClickMeta(request, { privacyEnabled: link.privacyEnabled })
  try {
    // Reserving the counter first makes max-click enforcement atomic even when
    // several redirects arrive at once.
    const [reserved] = await db
      .update(links)
      .set({ clickCount: sql`${links.clickCount} + 1` })
      .where(and(
        eq(links.id, link.id),
        or(isNull(links.maxClicks), lt(links.clickCount, links.maxClicks)),
      ))
      .returning({ id: links.id })
    if (!reserved) return 'limit-reached' as const
    try {
      await db.insert(clicks).values({ id: nanoid(), linkId: link.id, ...meta })
    } catch (error) {
      await db.update(links)
        .set({ clickCount: sql`greatest(${links.clickCount} - 1, 0)` })
        .where(eq(links.id, link.id))
        .catch(() => {})
      throw error
    }
    return 'recorded' as const
  } catch (err) {
    // Analytics must never break a redirect.
    console.error('click capture failed', err)
    return 'failed' as const
  }
}

/** Records a visit that didn't reach the destination. These don't count toward the click cap. */
async function recordVisit(
  link: typeof links.$inferSelect,
  request: Request,
  outcome: Exclude<ClickOutcome, 'redirected'>,
) {
  const meta = extractClickMeta(request, { privacyEnabled: link.privacyEnabled })
  await db.insert(clicks).values({ id: nanoid(), linkId: link.id, outcome, ...meta })
    .catch((err) => console.error('click capture failed', err))
}

/** Response for a link that can't redirect right now, and the outcome to record for the visit. */
function unavailable(link: typeof links.$inferSelect) {
  const availability = getLinkAvailability(link)
  if (availability.state === 'active') return null
  if (availability.fallbackUrl) {
    return { outcome: 'fallback', response: redirectResponse(availability.fallbackUrl) } as const
  }
  const messages = {
    paused: ['Link paused', 'This short link is temporarily unavailable.'],
    scheduled: ['Not active yet', `This short link activates ${link.startsAt ? new Date(link.startsAt).toLocaleString() : 'later'}.`],
    expired: ['Link expired', 'This short link is no longer active.'],
    'limit-reached': ['Visit limit reached', 'This short link has reached its visit limit.'],
  } as const
  const [title, message] = messages[availability.state]
  const status = availability.state === 'expired' ? 410 : 403
  return { outcome: 'blocked', response: page(title, `<h1>${title}</h1><p>${escapeHtml(message)}</p>`, status) } as const
}

/** Unavailable response for a link whose click cap filled up while this visit was in flight. */
const capReached = (link: typeof links.$inferSelect) =>
  unavailable({ ...link, clickCount: link.maxClicks ?? link.clickCount })!

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]!)
}

const passwordForm = (code: string, error = false, lockedRetrySec = 0) =>
  page(
    'Protected link',
    `<h1>Protected link</h1>
     <p>This link requires a password to continue.</p>
     ${lockedRetrySec > 0 ? `<p class="err">Too many attempts — try again in ${Math.ceil(lockedRetrySec / 60)} min.</p>` : ''}
     ${!lockedRetrySec && error ? '<p class="err">Incorrect password, try again.</p>' : ''}
     <form method="POST" action="/${escapeHtml(encodeURIComponent(code))}">
       <input type="password" name="password" placeholder="Password" maxlength="128" autocomplete="current-password" autofocus required ${lockedRetrySec > 0 ? 'disabled' : ''} />
       <button type="submit" ${lockedRetrySec > 0 ? 'disabled' : ''}>Continue</button>
     </form>`,
    lockedRetrySec > 0 ? 429 : error ? 401 : 200,
  )

// Brute-force guard for password-protected links: 5 failed attempts per
// link+IP within 15 minutes locks that IP out for the rest of the window.
const PW_LIMIT = 5
const PW_WINDOW_MS = 15 * 60 * 1000
const VISIT_LIMIT = 120
const VISIT_WINDOW_MS = 60 * 1000
const MAX_FORM_BYTES = 4 * 1024

function pwLimitKey(linkId: string, request: Request) {
  const ip = clientIp(request) ?? 'unknown'
  return `pw:${linkId}:${sha256(ip)}`
}

/** Per-IP visit limit, checked before anything is written for the visit. */
async function visitAllowed(link: typeof links.$inferSelect, request: Request) {
  const gate = await hitLimit(`visit:${link.id}:${sha256(clientIp(request) ?? 'unknown')}`, VISIT_LIMIT, VISIT_WINDOW_MS)
  return gate.allowed
}

const tooManyRequests = () =>
  page('Too many requests', '<h1>Too many requests</h1><p>Please try again shortly.</p>', 429)

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
        if (!(await visitAllowed(link, request))) return tooManyRequests()
        const inactive = unavailable(link)
        if (inactive) {
          await recordVisit(link, request, inactive.outcome)
          return inactive.response
        }
        if (link.passwordHash) {
          return passwordForm(link.code)
        }
        const result = await recordClick(link, request)
        if (result === 'limit-reached') {
          const capped = capReached(link)
          await recordVisit(link, request, capped.outcome)
          return capped.response
        }
        return redirectResponse(link.url)
      },
      POST: async ({ request, params }) => {
        const link = await resolve(params.code)
        if (!link) {
          return page('Not found', '<h1>404</h1><p>This link doesn\'t exist or was deleted.</p>', 404)
        }
        if (!(await visitAllowed(link, request))) return tooManyRequests()
        const inactive = unavailable(link)
        if (inactive) {
          await recordVisit(link, request, inactive.outcome)
          return inactive.response
        }
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
          return page('Unsupported request', '<h1>Unsupported request</h1>', 415)
        }
        const limitKey = pwLimitKey(link.id, request)
        // Every attempt is counted atomically *before* the password is
        // checked, so concurrent guesses can't slip past a stale read. A
        // locked-out IP is rejected even with the right password until the
        // window expires; success clears the counter below.
        const gate = await hitLimit(limitKey, PW_LIMIT, PW_WINDOW_MS)
        if (!gate.allowed) {
          return passwordForm(link.code, false, gate.retryAfterSec)
        }
        let password: string
        try {
          const body = await readBodyLimited(request, MAX_FORM_BYTES)
          password = new URLSearchParams(body).get('password') ?? ''
        } catch (error) {
          if (error instanceof BodyTooLargeError) {
            return page('Request too large', '<h1>Request too large</h1>', 413)
          }
          throw error
        }
        if (password.length > 128 || !link.passwordHash || !verifyPassword(password, link.passwordHash)) {
          await recordVisit(link, request, 'password_failed')
          return passwordForm(link.code, true)
        }
        await resetLimit(limitKey)
        const result = await recordClick(link, request)
        if (result === 'limit-reached') {
          const capped = capReached(link)
          await recordVisit(link, request, capped.outcome)
          return capped.response
        }
        return redirectResponse(link.url)
      },
    },
  },
})

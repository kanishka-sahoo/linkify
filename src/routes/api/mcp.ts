import { createFileRoute } from '@tanstack/react-router'
import { resolveApiKey } from '~/lib/keys'
import { BodyTooLargeError, readJsonLimited } from '~/lib/http'
import { json } from '~/lib/api-response'
import { JSONRPC_PARSE_ERROR, handlePost } from '~/lib/mcp-protocol'
import { linkifyMcpServer } from '~/lib/mcp-tools'

const MAX_JSON_BYTES = 64 * 1024

/** Browsers send Origin; agents don't. Rejecting foreign origins blocks DNS-rebinding attacks. */
function foreignOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return false
  const allowed = new Set([new URL(request.url).origin])
  for (const base of [process.env.APP_BASE_URL, process.env.BETTER_AUTH_URL]) {
    if (base) allowed.add(new URL(base).origin)
  }
  return !allowed.has(origin)
}

const notAllowed = () => new Response(null, { status: 405, headers: { allow: 'POST' } })

/**
 * Model Context Protocol endpoint (Streamable HTTP, JSON responses; protocol
 * 2026-07-28 plus the earlier handshake-based versions). Authenticates with
 * the same Bearer API keys as /api/v1; each tool needs one of the key's scopes.
 */
export const Route = createFileRoute('/api/mcp')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (foreignOrigin(request)) return json({ error: 'Forbidden origin' }, 403)
        const key = await resolveApiKey(request)
        if (!key) {
          return json({ error: 'Unauthorized' }, 401, { 'www-authenticate': 'Bearer realm="linkify"' })
        }
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
          return json({ error: 'Content-Type must be application/json' }, 415)
        }
        let body: unknown
        try {
          body = await readJsonLimited(request, MAX_JSON_BYTES)
        } catch (err) {
          if (err instanceof BodyTooLargeError) return json({ error: 'Request body too large' }, 413)
          return json({ jsonrpc: '2.0', id: null, error: { code: JSONRPC_PARSE_ERROR, message: 'Parse error' } }, 400)
        }
        const reply = await handlePost(linkifyMcpServer, request.headers, body, {
          actor: { id: key.userId, role: key.role },
          keyId: key.id,
          scopes: key.scopes,
          headers: request.headers,
        })
        return reply.body === null ? new Response(null, { status: reply.status }) : json(reply.body, reply.status)
      },
      // No sessions to end, and no standalone server-to-client stream: 2026-07-28
      // replaced GET with subscriptions/listen, and this server has nothing to push.
      GET: notAllowed,
      DELETE: notAllowed,
    },
  },
})

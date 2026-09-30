import { createFileRoute } from '@tanstack/react-router'
import { resolveApiKey } from '~/lib/keys'
import { BodyTooLargeError, readJsonLimited } from '~/lib/http'
import { json } from '~/lib/api-response'
import {
  JSONRPC_INVALID_REQUEST, JSONRPC_PARSE_ERROR, SUPPORTED_PROTOCOL_VERSIONS, handleBody,
} from '~/lib/mcp-protocol'
import { linkifyMcpServer } from '~/lib/mcp-tools'

const MAX_JSON_BYTES = 64 * 1024

const rpcError = (code: number, message: string, status: number) =>
  json({ jsonrpc: '2.0', id: null, error: { code, message } }, status)

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
 * Model Context Protocol endpoint (Streamable HTTP, stateless, JSON responses).
 * Authenticates with the same Bearer API keys as /api/v1; each tool needs one of the key's scopes.
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
        const version = request.headers.get('mcp-protocol-version')
        if (version && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
          return rpcError(JSONRPC_INVALID_REQUEST, `Unsupported MCP-Protocol-Version: ${version}`, 400)
        }
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
          return json({ error: 'Content-Type must be application/json' }, 415)
        }
        let body: unknown
        try {
          body = await readJsonLimited(request, MAX_JSON_BYTES)
        } catch (err) {
          if (err instanceof BodyTooLargeError) return json({ error: 'Request body too large' }, 413)
          return rpcError(JSONRPC_PARSE_ERROR, 'Parse error', 400)
        }
        const response = await handleBody(linkifyMcpServer, body, {
          actor: { id: key.userId, role: key.role },
          keyId: key.id,
          scopes: key.scopes,
          headers: request.headers,
        })
        if (response === null) return new Response(null, { status: 202 })
        return json(response)
      },
      // Stateless: no server-to-client SSE stream and no sessions to end.
      GET: notAllowed,
      DELETE: notAllowed,
    },
  },
})

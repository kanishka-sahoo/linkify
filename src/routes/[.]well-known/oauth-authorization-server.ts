import { createFileRoute } from '@tanstack/react-router'
import { authorizationServerMetadata } from '~/lib/oauth'
import { oauthJson, preflight } from '~/lib/oauth-http'

/** RFC 8414 metadata: where MCP clients register, send the user to approve, and fetch tokens. */
export const Route = createFileRoute('/.well-known/oauth-authorization-server')({
  server: {
    handlers: {
      GET: ({ request }) => oauthJson(authorizationServerMetadata(request.url), 200, { 'cache-control': 'public, max-age=3600' }),
      OPTIONS: preflight,
    },
  },
})

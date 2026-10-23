import { createFileRoute } from '@tanstack/react-router'
import { protectedResourceMetadata } from '~/lib/oauth'
import { oauthJson, preflight } from '~/lib/oauth-http'

/** RFC 9728 metadata for the MCP endpoint; see also the path-suffixed variant. */
export const Route = createFileRoute('/.well-known/oauth-protected-resource')({
  server: {
    handlers: {
      GET: ({ request }) => oauthJson(protectedResourceMetadata(request.url), 200, { 'cache-control': 'public, max-age=3600' }),
      OPTIONS: preflight,
    },
  },
})

import { createFileRoute } from '@tanstack/react-router'
import { protectedResourceMetadata } from '~/lib/oauth'
import { oauthJson, preflight } from '~/lib/oauth-http'

/** RFC 9728 inserts the resource's path after the well-known name; clients try this URL first. */
export const Route = createFileRoute('/.well-known/oauth-protected-resource/api/mcp')({
  server: {
    handlers: {
      GET: ({ request }) => oauthJson(protectedResourceMetadata(request.url), 200, { 'cache-control': 'public, max-age=3600' }),
      OPTIONS: preflight,
    },
  },
})

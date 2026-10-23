import { createFileRoute } from '@tanstack/react-router'
import { OAuthError } from '~/lib/oauth'
import { oauthErrorResponse, oauthJson, preflight, readParams } from '~/lib/oauth-http'
import { authenticateClient, revokeToken } from '~/lib/oauth-store'

/** RFC 7009 token revocation: disconnects the app the token belongs to. */
export const Route = createFileRoute('/api/oauth/revoke')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const params = await readParams(request)
          const client = await authenticateClient(request.headers, params)
          if (!params.token) throw new OAuthError('invalid_request', 'token is required')
          await revokeToken(client, params.token)
          return oauthJson({})
        } catch (err) {
          return oauthErrorResponse(err)
        }
      },
      OPTIONS: preflight,
    },
  },
})

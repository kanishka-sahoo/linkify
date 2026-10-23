import { createFileRoute } from '@tanstack/react-router'
import { OAuthError, checkResource } from '~/lib/oauth'
import { oauthErrorResponse, oauthJson, preflight, readParams } from '~/lib/oauth-http'
import { authenticateClient, exchangeCode, refreshGrant } from '~/lib/oauth-store'

/** OAuth token endpoint: authorization_code (with PKCE) and refresh_token grants. */
export const Route = createFileRoute('/api/oauth/token')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const params = await readParams(request)
          const client = await authenticateClient(request.headers, params)
          checkResource(params.resource, request.url)
          switch (params.grant_type) {
            case 'authorization_code':
              return oauthJson(await exchangeCode(client, params))
            case 'refresh_token':
              return oauthJson(await refreshGrant(client, params))
            default:
              throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token')
          }
        } catch (err) {
          return oauthErrorResponse(err)
        }
      },
      OPTIONS: preflight,
    },
  },
})

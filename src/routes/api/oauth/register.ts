import { createFileRoute } from '@tanstack/react-router'
import { clientIp } from '~/lib/keys'
import { hitLimit } from '~/lib/ratelimit'
import { BodyTooLargeError, readJsonLimited } from '~/lib/http'
import { OAuthError, parseRegistration } from '~/lib/oauth'
import { oauthErrorResponse, oauthJson, preflight } from '~/lib/oauth-http'
import { registerClient } from '~/lib/oauth-store'

const MAX_JSON_BYTES = 16 * 1024

/**
 * RFC 7591 dynamic client registration. Open, as MCP hosts expect: a
 * registered client can do nothing until a signed-in user approves it.
 */
export const Route = createFileRoute('/api/oauth/register')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const limit = await hitLimit(`oauth-register:${clientIp(request) ?? 'unknown'}`, 20, 60 * 60 * 1000)
        if (!limit.allowed) {
          return oauthJson({ error: 'too_many_requests' }, 429, { 'retry-after': String(limit.retryAfterSec) })
        }
        try {
          let body: unknown
          try {
            body = await readJsonLimited(request, MAX_JSON_BYTES)
          } catch (err) {
            if (err instanceof BodyTooLargeError) throw new OAuthError('invalid_client_metadata', 'Request body too large', 413)
            throw new OAuthError('invalid_client_metadata', 'Body must be JSON')
          }
          const registration = parseRegistration(body)
          const { client, secret } = await registerClient(registration)
          return oauthJson({
            client_id: client.id,
            client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
            ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
            client_name: client.name,
            redirect_uris: client.redirectUris,
            token_endpoint_auth_method: client.authMethod,
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
          }, 201)
        } catch (err) {
          return oauthErrorResponse(err)
        }
      },
      OPTIONS: preflight,
    },
  },
})

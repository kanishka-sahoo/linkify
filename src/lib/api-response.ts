import { LinkError } from './link-service'

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  })
}

/** A LinkError as its JSON error response; anything else is rethrown. */
export function linkErrorResponse(err: unknown) {
  if (!(err instanceof LinkError)) throw err
  return json({ error: err.message }, err.status, err.retryAfterSec === undefined ? {} : {
    'retry-after': String(err.retryAfterSec),
  })
}

import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { desc, eq } from 'drizzle-orm'
import { auth } from './auth'
import { db } from './db'
import { apiKeys, passkey } from './schema'

/**
 * Everything the settings page renders, in one server round trip.
 * Previously the page fetched 2FA status and passkeys in client-side
 * effects after hydration — two extra serverless invocations per load.
 */
export const getSettingsData = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Unauthorized')
  const [keys, passkeys] = await Promise.all([
    db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
      })
      .from(apiKeys)
      .orderBy(desc(apiKeys.createdAt)),
    db
      .select({ id: passkey.id, name: passkey.name, createdAt: passkey.createdAt })
      .from(passkey)
      .where(eq(passkey.userId, session.user.id)),
  ])
  return {
    keys,
    passkeys,
    twoFactorEnabled: Boolean(session.user.twoFactorEnabled),
  }
})

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { twoFactor } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { db } from './db'
import { user } from './schema'
import { count } from 'drizzle-orm'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  emailAndPassword: {
    enabled: true,
    // Sign-up is only possible while no user exists (enforced below and in the UI).
  },
  trustedOrigins: (request) => {
    const origins = [process.env.BETTER_AUTH_URL].filter(
      (o): o is string => Boolean(o),
    )
    // In local development, trust whatever host the request arrived on —
    // covers localhost, LAN IPs, and Tailscale IPs / MagicDNS names.
    if (process.env.NODE_ENV !== 'production' && request) {
      const host =
        request.headers.get('x-forwarded-host') ?? request.headers.get('host')
      if (host) origins.push(`http://${host}`, `https://${host}`)
    }
    return origins
  },
  plugins: [
    twoFactor(),
    passkey({
      rpName: process.env.PASSKEY_RP_NAME ?? 'Linkify',
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        before: async () => {
          // Single-tenant lockdown: only the very first user may register.
          const [{ value }] = await db.select({ value: count() }).from(user)
          if (value > 0) {
            throw new Error('Registration is closed')
          }
        },
      },
    },
  },
})

export type Session = typeof auth.$Infer.Session

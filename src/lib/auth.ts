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
  user: {
    additionalFields: {
      // 'admin' | 'user' — first account created becomes admin; only admins
      // can create accounts after that (enforced in the hook below).
      role: { type: 'string', defaultValue: 'user', input: false },
    },
  },
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
        before: async (userData, ctx) => {
          const [{ value }] = await db.select({ value: count() }).from(user)
          // First-run setup: the very first account becomes the admin.
          if (value === 0) return { data: { ...userData, role: 'admin' } }
          // After that, accounts can only be created by a signed-in admin.
          const session = ctx?.headers
            ? await auth.api.getSession({ headers: ctx.headers }).catch(() => null)
            : null
          if (!session || session.user.role !== 'admin') {
            throw new Error('Only an admin can create accounts')
          }
        },
      },
    },
  },
})

export type Session = typeof auth.$Infer.Session

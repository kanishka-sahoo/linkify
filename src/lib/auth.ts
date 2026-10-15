import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { twoFactor, username } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { db } from './db'
import { user } from './schema'
import { count, eq } from 'drizzle-orm'
import { createHash, timingSafeEqual } from 'node:crypto'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { auditEvent } from './audit'
import { GUEST_READ_ONLY, isGuest } from './account-policy'

/** The only auth endpoints a signed-in guest may call; see isGuest(). */
function guestMayCall(path: string) {
  return path === '/get-session' || path === '/sign-out' || path.startsWith('/sign-in/')
}

function secretMatches(provided: string | null, expected: string | undefined) {
  if (!provided || !expected || expected.length < 32) return false
  const left = createHash('sha256').update(provided).digest()
  const right = createHash('sha256').update(expected).digest()
  return timingSafeEqual(left, right)
}

const authSecret = process.env.BETTER_AUTH_SECRET
if (process.env.NODE_ENV === 'production' && (!authSecret || authSecret.length < 32)) {
  throw new Error('BETTER_AUTH_SECRET must be at least 32 characters in production')
}

export const auth = betterAuth({
  secret: authSecret,
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  user: {
    additionalFields: {
      // 'admin' | 'user' | 'guest' — first account created becomes admin; only
      // admins can create accounts after that (enforced in the hook below).
      role: { type: 'string', defaultValue: 'user', input: false },
      mustChangePassword: { type: 'boolean', defaultValue: false, input: false },
      bootstrapOwner: { type: 'boolean', defaultValue: false, input: false },
      deactivatedAt: { type: 'date', required: false, input: false },
    },
  },
  // Public username lookups would let anyone enumerate accounts.
  disabledPaths: ['/is-username-available'],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    // Sign-up is only possible while no user exists (enforced below and in the UI).
  },
  session: {
    expiresIn: 60 * 60 * 24,
    updateAge: 60 * 60 * 6,
  },
  rateLimit: {
    enabled: true,
    storage: 'database',
    modelName: 'authRateLimit',
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-in/username': { window: 60, max: 5 },
      '/sign-up/email': { window: 60 * 15, max: 5 },
      '/two-factor/*': { window: 60, max: 5 },
      '/passkey/*': { window: 60, max: 10 },
    },
  },
  advanced: {
    ipAddress: {
      // The deployment proxy must overwrite this header. Vercel does so.
      ipAddressHeaders: [process.env.TRUSTED_IP_HEADER ?? 'x-real-ip'],
      ipv6Subnet: 64,
    },
  },
  hooks: {
    // Shared guest credentials must stay usable: block a guest from changing
    // their password, 2FA, passkeys, profile, or other viewers' sessions.
    before: createAuthMiddleware(async (ctx) => {
      if (guestMayCall(ctx.path) || !ctx.headers) return
      const session = await auth.api.getSession({ headers: ctx.headers }).catch(() => null)
      if (session && isGuest(session.user)) throw new APIError('FORBIDDEN', { message: GUEST_READ_ONLY })
    }),
    after: createAuthMiddleware(async (ctx) => {
      const tracked = new Map<string, string>([
        ['/sign-in/email', 'auth.sign_in'],
        ['/sign-in/username', 'auth.sign_in'],
        ['/sign-up/email', 'auth.sign_up'],
        ['/change-password', 'auth.password_change'],
        ['/two-factor/enable', 'auth.two_factor_enable'],
        ['/two-factor/disable', 'auth.two_factor_disable'],
        ['/two-factor/verify-totp', 'auth.two_factor_verify'],
        ['/passkey/add-passkey', 'auth.passkey_add'],
        ['/passkey/delete-passkey', 'auth.passkey_delete'],
      ])
      const baseAction = tracked.get(ctx.path)
      if (!baseAction) return
      const context = ctx.context as unknown as {
        newSession?: { user?: { id?: string } } | null
        session?: { user?: { id?: string }; userId?: string } | null
        returned?: unknown
      }
      const actorUserId =
        context.newSession?.user?.id ?? context.session?.user?.id ?? context.session?.userId ?? null
      const returned = context.returned
      const failed = returned instanceof Error || (returned instanceof Response && returned.status >= 400)
      const body = ctx.body as { email?: unknown; username?: unknown } | undefined
      const [targetType, login] =
        typeof body?.email === 'string' ? ['email', body.email]
          : typeof body?.username === 'string' ? ['username', body.username]
            : [null, null]
      await auditEvent({
        action: `${baseAction}.${failed ? 'failed' : 'succeeded'}`,
        actorUserId,
        targetType,
        targetId: login?.trim().toLowerCase() ?? null,
        headers: ctx.headers,
      })
    }),
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
    // Usernames can't contain '@', so the login form tells them apart from emails.
    username(),
    passkey({
      rpName: process.env.PASSKEY_RP_NAME ?? 'Linkify',
    }),
  ],
  databaseHooks: {
    session: {
      create: {
        // Covers every sign-in method (password, TOTP, passkey).
        before: async (sessionData) => {
          const [row] = await db
            .select({ deactivatedAt: user.deactivatedAt })
            .from(user)
            .where(eq(user.id, sessionData.userId))
          if (row?.deactivatedAt) {
            throw new APIError('FORBIDDEN', { message: 'This account has been deactivated' })
          }
        },
      },
    },
    user: {
      create: {
        before: async (userData, ctx) => {
          const [{ value }] = await db.select({ value: count() }).from(user)
          // First-run setup: the very first account becomes the admin.
          if (value === 0) {
            const setupSecret = ctx?.headers?.get('x-linkify-setup-secret') ?? null
            if (!secretMatches(setupSecret, process.env.SETUP_SECRET)) {
              throw new APIError('FORBIDDEN', {
                message: 'A valid one-time setup secret is required',
              })
            }
            return {
              data: {
                ...userData,
                role: 'admin',
                bootstrapOwner: true,
                mustChangePassword: false,
              },
            }
          }
          // After that, accounts can only be created by a signed-in admin.
          const session = ctx?.headers
            ? await auth.api.getSession({ headers: ctx.headers }).catch(() => null)
            : null
          if (
            !session ||
            session.user.role !== 'admin' ||
            session.user.mustChangePassword ||
            !session.user.twoFactorEnabled
          ) {
            throw new Error('Only an admin can create accounts')
          }
          return { data: { ...userData, mustChangePassword: true } }
        },
      },
    },
  },
})

export type Session = typeof auth.$Infer.Session

import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { and, desc, eq, like, ne, or } from 'drizzle-orm'
import { auth } from './auth'
import { db } from './db'
import { apiKeys, auditLogs, passkey, session as sessionTable, user } from './schema'
import { auditEvent } from './audit'

async function currentSession() {
  const headers = getRequestHeaders()
  const current = await auth.api.getSession({ headers })
  if (!current) throw new Error('Unauthorized')
  return { current, headers }
}

/**
 * Everything the settings page renders, in one server round trip.
 * Previously the page fetched 2FA status and passkeys in client-side
 * effects after hydration — two extra serverless invocations per load.
 */
export const getSettingsData = createServerFn({ method: 'GET' }).handler(async () => {
  const { current } = await currentSession()
  const [keys, passkeys, sessions, securityEvents] = await Promise.all([
    db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        scopes: apiKeys.scopes,
        expiresAt: apiKeys.expiresAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, current.user.id))
      .orderBy(desc(apiKeys.createdAt)),
    db
      .select({ id: passkey.id, name: passkey.name, createdAt: passkey.createdAt })
      .from(passkey)
      .where(eq(passkey.userId, current.user.id)),
    db
      .select({
        id: sessionTable.id,
        createdAt: sessionTable.createdAt,
        updatedAt: sessionTable.updatedAt,
        expiresAt: sessionTable.expiresAt,
        ipAddress: sessionTable.ipAddress,
        userAgent: sessionTable.userAgent,
      })
      .from(sessionTable)
      .where(eq(sessionTable.userId, current.user.id))
      .orderBy(desc(sessionTable.updatedAt)),
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        ip: auditLogs.ip,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(and(
        or(eq(auditLogs.actorUserId, current.user.id), eq(auditLogs.targetId, current.user.email)),
        or(
          like(auditLogs.action, 'auth.%'),
          like(auditLogs.action, 'api_key.%'),
          like(auditLogs.action, 'admin.user.%'),
        ),
      ))
      .orderBy(desc(auditLogs.createdAt))
      .limit(20),
  ])
  return {
    keys,
    passkeys,
    sessions: sessions.map((row) => ({ ...row, current: row.id === current.session.id })),
    securityEvents,
    twoFactorEnabled: Boolean(current.user.twoFactorEnabled),
    mustChangePassword: Boolean(current.user.mustChangePassword),
    // Mirrors the dashboard guard: admins can't leave settings until they enroll TOTP.
    twoFactorRequired: current.user.role === 'admin' && !current.user.twoFactorEnabled,
  }
})

function objectInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input')
  return input as Record<string, unknown>
}

export const changeMyPassword = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const value = objectInput(input)
    if (typeof value.currentPassword !== 'string' || value.currentPassword.length > 128) {
      throw new Error('Current password is required')
    }
    if (typeof value.newPassword !== 'string' || value.newPassword.length < 12 || value.newPassword.length > 128) {
      throw new Error('New password must be between 12 and 128 characters')
    }
    return { currentPassword: value.currentPassword, newPassword: value.newPassword }
  })
  .handler(async ({ data }) => {
    const { current, headers } = await currentSession()
    // better-auth's revokeOtherSessions also deletes the current session and
    // sets a replacement cookie, which a server function can't forward, so
    // the browser would be signed out. Keep this session; revoke the rest.
    await auth.api.changePassword({ body: data, headers })
    await db
      .update(user)
      .set({ mustChangePassword: false, updatedAt: new Date() })
      .where(eq(user.id, current.user.id))
    await db
      .delete(sessionTable)
      .where(and(eq(sessionTable.userId, current.user.id), ne(sessionTable.id, current.session.id)))
    await auditEvent({ action: 'auth.password.changed', actorUserId: current.user.id, headers })
    return { ok: true }
  })

export const revokeSession = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const value = objectInput(input)
    if (typeof value.id !== 'string' || !value.id || value.id.length > 128) throw new Error('Invalid session')
    return { id: value.id }
  })
  .handler(async ({ data }) => {
    const { current, headers } = await currentSession()
    if (data.id === current.session.id) throw new Error('Use sign out to end the current session')
    await db.delete(sessionTable).where(and(eq(sessionTable.id, data.id), eq(sessionTable.userId, current.user.id)))
    await auditEvent({
      action: 'auth.session.revoked',
      actorUserId: current.user.id,
      targetType: 'session',
      targetId: data.id,
      headers,
    })
    return { ok: true }
  })

export const revokeOtherSessions = createServerFn({ method: 'POST' }).handler(async () => {
  const { current, headers } = await currentSession()
  await db
    .delete(sessionTable)
    .where(and(eq(sessionTable.userId, current.user.id), ne(sessionTable.id, current.session.id)))
  await auditEvent({ action: 'auth.sessions.revoked_other', actorUserId: current.user.id, headers })
  return { ok: true }
})

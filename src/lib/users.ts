import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm'
import { auth } from './auth'
import { db } from './db'
import { links, session as sessionTable, user } from './schema'
import { auditEvent } from './audit'
import { accountRestriction } from './account-policy'

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Unauthorized')
  if (session.user.role !== 'admin') throw new Error('Admin access required')
  const restriction = accountRestriction(session.user)
  if (restriction) throw new Error(restriction)
  return session.user
}

/** id/name/email of every account — used to label link owners. Any signed-in user may call it. */
export const listUserDirectory = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Unauthorized')
  const query = db
    .select({ id: user.id, name: user.name, email: user.email, deactivatedAt: user.deactivatedAt })
    .from(user)
    .$dynamic()
  return (session.user.role === 'admin' ? query : query.where(eq(user.id, session.user.id))).orderBy(asc(user.createdAt))
})

/** Admins who can still sign in; deactivated admins don't count toward last-admin protection. */
async function activeAdminCount() {
  const [{ value }] = await db
    .select({ value: count() })
    .from(user)
    .where(and(eq(user.role, 'admin'), isNull(user.deactivatedAt)))
  return value
}

async function findUser(id: string) {
  const [target] = await db
    .select({ role: user.role, deactivatedAt: user.deactivatedAt })
    .from(user)
    .where(eq(user.id, id))
  if (!target) throw new Error('User not found')
  return target
}

function parseUserId(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input')
  const id = (input as Record<string, unknown>).id
  if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid user')
  return { id }
}

export const listUsers = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdmin()
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      twoFactorEnabled: user.twoFactorEnabled,
      deactivatedAt: user.deactivatedAt,
      createdAt: user.createdAt,
      linkCount: sql<number>`(select count(*)::int from ${links} where ${links.userId} = ${user.id})`,
    })
    .from(user)
    .orderBy(asc(user.createdAt))
})

export const createUser = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input')
    const value = input as Record<string, unknown>
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('Name is required')
    if (typeof value.email !== 'string' || value.email.length > 320 || !value.email.includes('@')) throw new Error('Valid email is required')
    if (typeof value.password !== 'string' || value.password.length < 12 || value.password.length > 128) {
      throw new Error('Temporary password must be between 12 and 128 characters')
    }
    return { name: value.name, email: value.email, password: value.password }
  })
  .handler(async ({ data }) => {
    const me = await requireAdmin()
    // Forward the caller's session headers so the creation hook in auth.ts
    // recognizes this as an authorized admin action.
    const result = await auth.api.signUpEmail({
      body: {
        name: data.name.trim(),
        email: data.email.trim().toLowerCase(),
        password: data.password,
      },
      headers: getRequestHeaders(),
    })
    await auditEvent({
      action: 'admin.user.created',
      actorUserId: me.id,
      targetType: 'user',
      targetId: result.user.id,
      headers: getRequestHeaders(),
    })
    return { id: result.user.id, email: result.user.email }
  })

export const setUserRole = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input')
    const value = input as Record<string, unknown>
    if (typeof value.id !== 'string' || !value.id || value.id.length > 128) throw new Error('Invalid user')
    if (value.role !== 'admin' && value.role !== 'user') throw new Error('Invalid role')
    return { id: value.id, role: value.role }
  })
  .handler(async ({ data }) => {
    const me = await requireAdmin()
    if (data.id === me.id) throw new Error("You can't change your own role")
    const target = await findUser(data.id)
    if (target.deactivatedAt) throw new Error('Reactivate this account before changing its role')
    if (data.role !== 'admin' && target.role === 'admin' && (await activeAdminCount()) <= 1) {
      throw new Error("You can't demote the last admin")
    }
    await db
      .update(user)
      .set({ role: data.role, updatedAt: new Date() })
      .where(eq(user.id, data.id))
    await auditEvent({
      action: 'admin.user.role_changed',
      actorUserId: me.id,
      targetType: 'user',
      targetId: data.id,
      headers: getRequestHeaders(),
      metadata: { role: data.role },
    })
    return { ok: true }
  })

/**
 * Deactivate an admin who has left. They can't sign in and their API keys
 * stop working, but their links keep redirecting until another admin takes
 * them over. Regular users are deleted instead (see deleteUser).
 */
export const deactivateUser = createServerFn({ method: 'POST' })
  .validator(parseUserId)
  .handler(async ({ data }) => {
    const me = await requireAdmin()
    if (data.id === me.id) throw new Error("You can't deactivate your own account")
    const target = await findUser(data.id)
    if (target.role !== 'admin') throw new Error('Only admins can be deactivated; delete user accounts instead')
    if (target.deactivatedAt) throw new Error('This account is already deactivated')
    if ((await activeAdminCount()) <= 1) throw new Error("You can't deactivate the last admin")
    // Set the flag first so no new session can be created before the old ones are revoked.
    await db
      .update(user)
      .set({ deactivatedAt: new Date(), updatedAt: new Date() })
      .where(eq(user.id, data.id))
    await db.delete(sessionTable).where(eq(sessionTable.userId, data.id))
    await auditEvent({
      action: 'admin.user.deactivated',
      actorUserId: me.id,
      targetType: 'user',
      targetId: data.id,
      headers: getRequestHeaders(),
    })
    return { ok: true }
  })

export const reactivateUser = createServerFn({ method: 'POST' })
  .validator(parseUserId)
  .handler(async ({ data }) => {
    const me = await requireAdmin()
    await findUser(data.id)
    await db
      .update(user)
      .set({ deactivatedAt: null, updatedAt: new Date() })
      .where(eq(user.id, data.id))
    await auditEvent({
      action: 'admin.user.reactivated',
      actorUserId: me.id,
      targetType: 'user',
      targetId: data.id,
      headers: getRequestHeaders(),
    })
    return { ok: true }
  })

/** Move every link owned by another account, admin or user, to the calling admin. */
export const takeOverLinks = createServerFn({ method: 'POST' })
  .validator(parseUserId)
  .handler(async ({ data }) => {
    const me = await requireAdmin()
    if (data.id === me.id) throw new Error('These links are already yours')
    await findUser(data.id)
    const moved = await db
      .update(links)
      .set({ userId: me.id, updatedAt: new Date() })
      .where(eq(links.userId, data.id))
      .returning({ id: links.id })
    await auditEvent({
      action: 'admin.user.links_taken_over',
      actorUserId: me.id,
      targetType: 'user',
      targetId: data.id,
      headers: getRequestHeaders(),
      metadata: { count: moved.length },
    })
    return { count: moved.length }
  })

/**
 * Delete a user, or an admin who was deactivated first. Their links, with
 * their analytics, move to the calling admin so shared short links keep working.
 */
export const deleteUser = createServerFn({ method: 'POST' })
  .validator(parseUserId)
  .handler(async ({ data }) => {
    const me = await requireAdmin()
    if (data.id === me.id) throw new Error("You can't delete your own account")
    const target = await findUser(data.id)
    if (target.role === 'admin' && !target.deactivatedAt) {
      throw new Error('Deactivate this admin before deleting their account')
    }
    // One statement, so a failed delete can't leave links half-moved. The user
    // delete cascades to sessions, accounts, API keys, passkeys and 2FA rows.
    const result = await db.execute<{ count: number }>(sql`
      with moved as (
        update ${links} set user_id = ${me.id}, updated_at = now()
        where ${links.userId} = ${data.id}
        returning 1
      ), removed as (
        delete from ${user} where ${user.id} = ${data.id}
      )
      select count(*)::int as count from moved
    `)
    const transferred = result.rows[0]?.count ?? 0
    await auditEvent({
      action: 'admin.user.deleted',
      actorUserId: me.id,
      targetType: 'user',
      targetId: data.id,
      headers: getRequestHeaders(),
      metadata: { linksTransferredTo: me.id, count: transferred },
    })
    return { ok: true, transferred }
  })

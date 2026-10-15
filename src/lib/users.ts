import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { and, asc, count, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import { auth } from './auth'
import { db } from './db'
import { guestAccess, links, session as sessionTable, user } from './schema'
import { auditEvent } from './audit'
import { accountRestriction, isGuest } from './account-policy'

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
    .select({ id: user.id, name: user.name, email: user.email, role: user.role, deactivatedAt: user.deactivatedAt })
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
      username: user.displayUsername,
      role: user.role,
      twoFactorEnabled: user.twoFactorEnabled,
      deactivatedAt: user.deactivatedAt,
      createdAt: user.createdAt,
      linkCount: sql<number>`(select count(*)::int from ${links} where ${links.userId} = ${user.id})`,
      guestOwnerIds: sql<string[]>`array(select ${guestAccess.ownerId} from ${guestAccess} where ${guestAccess.guestId} = ${user.id})`,
    })
    .from(user)
    .orderBy(asc(user.createdAt))
})

function parseNewAccount(value: Record<string, unknown>) {
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('Name is required')
  if (typeof value.email !== 'string' || value.email.length > 320 || !value.email.includes('@')) throw new Error('Valid email is required')
  if (typeof value.password !== 'string' || value.password.length < 12 || value.password.length > 128) {
    throw new Error('Password must be between 12 and 128 characters')
  }
  // Optional; better-auth's username plugin validates format and uniqueness.
  if (value.username !== undefined && (typeof value.username !== 'string' || value.username.length > 30)) {
    throw new Error('Username must be at most 30 characters')
  }
  return { name: value.name, email: value.email, password: value.password, username: value.username?.trim() || undefined }
}

function parseOwnerIds(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Choose at most 100 accounts')
  if (value.some((id) => typeof id !== 'string' || !id || id.length > 128)) throw new Error('Invalid account')
  return [...new Set(value as string[])]
}

/** Create an account through better-auth so it gets a credential and the creation hook runs. */
async function signUp(data: { name: string; email: string; password: string; username?: string }) {
  // Forward the caller's session headers so the creation hook in auth.ts
  // recognizes this as an authorized admin action.
  const result = await auth.api.signUpEmail({
    body: {
      name: data.name.trim(),
      email: data.email.trim().toLowerCase(),
      password: data.password,
      username: data.username,
    },
    headers: getRequestHeaders(),
  })
  return result.user
}

/** Replace which accounts a guest can view. Guests can't be granted other guests. */
async function grantGuestAccess(guestId: string, ownerIds: string[]) {
  if (ownerIds.length > 0) {
    const owners = await db
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(inArray(user.id, ownerIds))
    if (owners.length !== ownerIds.length) throw new Error('Account not found')
    if (owners.some(isGuest)) throw new Error("Guests can't be given access to other guests")
  }
  // Two statements rather than delete-all + insert, so a failure part-way
  // never leaves the guest with access to accounts outside the new set.
  await db
    .delete(guestAccess)
    .where(and(
      eq(guestAccess.guestId, guestId),
      ownerIds.length > 0 ? notInArray(guestAccess.ownerId, ownerIds) : undefined,
    ))
  if (ownerIds.length > 0) {
    await db
      .insert(guestAccess)
      .values(ownerIds.map((ownerId) => ({ guestId, ownerId })))
      .onConflictDoNothing()
  }
}

export const createUser = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input')
    return parseNewAccount(input as Record<string, unknown>)
  })
  .handler(async ({ data }) => {
    const me = await requireAdmin()
    const created = await signUp(data)
    await auditEvent({
      action: 'admin.user.created',
      actorUserId: me.id,
      targetType: 'user',
      targetId: created.id,
      headers: getRequestHeaders(),
    })
    return { id: created.id, email: created.email }
  })

/**
 * Create a read-only guest that can view the links and analytics of
 * `ownerIds`. The password is final: guests can't change it, so the
 * credentials can be shared (e.g. for a demo) without being taken over.
 */
export const createGuest = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input')
    const value = input as Record<string, unknown>
    return { ...parseNewAccount(value), ownerIds: parseOwnerIds(value.ownerIds) }
  })
  .handler(async ({ data }) => {
    const me = await requireAdmin()
    const created = await signUp(data)
    await db
      .update(user)
      .set({ role: 'guest', mustChangePassword: false, updatedAt: new Date() })
      .where(eq(user.id, created.id))
    // signUpEmail signs the new account in; that session belongs to no one.
    await db.delete(sessionTable).where(eq(sessionTable.userId, created.id))
    await grantGuestAccess(created.id, data.ownerIds)
    await auditEvent({
      action: 'admin.guest.created',
      actorUserId: me.id,
      targetType: 'user',
      targetId: created.id,
      headers: getRequestHeaders(),
      metadata: { ownerIds: data.ownerIds },
    })
    return { id: created.id, email: created.email }
  })

export const setGuestAccess = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    ...parseUserId(input),
    ownerIds: parseOwnerIds((input as Record<string, unknown>).ownerIds),
  }))
  .handler(async ({ data }) => {
    const me = await requireAdmin()
    const target = await findUser(data.id)
    if (!isGuest(target)) throw new Error('Only guest accounts have limited access')
    await grantGuestAccess(data.id, data.ownerIds)
    await auditEvent({
      action: 'admin.guest.access_changed',
      actorUserId: me.id,
      targetType: 'user',
      targetId: data.id,
      headers: getRequestHeaders(),
      metadata: { ownerIds: data.ownerIds },
    })
    return { ok: true }
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
    if (isGuest(target)) throw new Error("Guest accounts can't change role; create a new account instead")
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

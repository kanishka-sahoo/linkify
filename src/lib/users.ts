import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { asc, count, eq } from 'drizzle-orm'
import { auth } from './auth'
import { db } from './db'
import { user } from './schema'

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Unauthorized')
  if (session.user.role !== 'admin') throw new Error('Admin access required')
  return session.user
}

async function adminCount() {
  const [{ value }] = await db
    .select({ value: count() })
    .from(user)
    .where(eq(user.role, 'admin'))
  return value
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
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(asc(user.createdAt))
})

export const createUser = createServerFn({ method: 'POST' })
  .validator((input: { name: string; email: string; password: string }) => input)
  .handler(async ({ data }) => {
    await requireAdmin()
    if (!data.name?.trim()) throw new Error('Name is required')
    if (!data.email?.includes('@')) throw new Error('Valid email is required')
    if (!data.password || data.password.length < 8)
      throw new Error('Password must be at least 8 characters')
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
    return { id: result.user.id, email: result.user.email }
  })

export const setUserRole = createServerFn({ method: 'POST' })
  .validator((input: { id: string; role: 'admin' | 'user' }) => input)
  .handler(async ({ data }) => {
    const me = await requireAdmin()
    if (data.id === me.id) throw new Error("You can't change your own role")
    if (data.role !== 'admin') {
      const [target] = await db
        .select({ role: user.role })
        .from(user)
        .where(eq(user.id, data.id))
      if (target?.role === 'admin' && (await adminCount()) <= 1) {
        throw new Error("You can't demote the last admin")
      }
    }
    await db
      .update(user)
      .set({ role: data.role, updatedAt: new Date() })
      .where(eq(user.id, data.id))
    return { ok: true }
  })

export const deleteUser = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const me = await requireAdmin()
    if (data.id === me.id) throw new Error("You can't delete your own account")
    const [{ value }] = await db.select({ value: count() }).from(user)
    if (value <= 1) throw new Error("You can't delete the last account")
    const [target] = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, data.id))
    if (target?.role === 'admin' && (await adminCount()) <= 1) {
      throw new Error("You can't delete the last admin")
    }
    // Cascades to sessions, accounts, passkeys and 2FA rows.
    await db.delete(user).where(eq(user.id, data.id))
    return { ok: true }
  })

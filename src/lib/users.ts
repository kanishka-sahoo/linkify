import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { asc, count, eq } from 'drizzle-orm'
import { auth } from './auth'
import { db } from './db'
import { user } from './schema'

async function requireUser() {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Unauthorized')
  return session.user
}

export const listUsers = createServerFn({ method: 'GET' }).handler(async () => {
  await requireUser()
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(asc(user.createdAt))
})

export const createUser = createServerFn({ method: 'POST' })
  .validator((input: { name: string; email: string; password: string }) => input)
  .handler(async ({ data }) => {
    await requireUser()
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

export const deleteUser = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const me = await requireUser()
    if (data.id === me.id) throw new Error("You can't delete your own account")
    const [{ value }] = await db.select({ value: count() }).from(user)
    if (value <= 1) throw new Error("You can't delete the last account")
    // Cascades to sessions, accounts, passkeys and 2FA rows.
    await db.delete(user).where(eq(user.id, data.id))
    return { ok: true }
  })

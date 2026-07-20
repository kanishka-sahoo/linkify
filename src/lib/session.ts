import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from './auth'
import { db } from './db'
import { user } from './schema'
import { count } from 'drizzle-orm'

/** Returns the current session or null. */
export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  return session
})

/** True while zero users exist — first-run setup is allowed only then. */
export const needsSetup = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ value }] = await db.select({ value: count() }).from(user)
  return value === 0
})

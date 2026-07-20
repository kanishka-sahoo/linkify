import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from './auth'
import { db } from './db'
import { user } from './schema'
import { count } from 'drizzle-orm'

/**
 * One round trip that answers both routing questions every page asks:
 * is first-run setup needed, and who is signed in. Replaces separate
 * needsSetup() + getSession() calls in route beforeLoad hooks.
 */
export const getBootstrap = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  // A valid session proves at least one user exists — skip the count query.
  if (session) return { needsSetup: false, user: session.user }
  const [{ value }] = await db.select({ value: count() }).from(user)
  return { needsSetup: value === 0, user: null }
})

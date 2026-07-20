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
  const [session, [{ value }]] = await Promise.all([
    auth.api.getSession({ headers: getRequestHeaders() }),
    db.select({ value: count() }).from(user),
  ])
  return { needsSetup: value === 0, user: session?.user ?? null }
})

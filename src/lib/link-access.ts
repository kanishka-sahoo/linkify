import { and, eq, sql } from 'drizzle-orm'
import { guestAccess, links } from './schema'
import { isGuest } from './account-policy'

// Kept apart from link-service: client routes import links.ts, which re-exports
// these, and link-service would pull node-only modules into the browser bundle.

/**
 * WHERE clause restricting links to those the actor may see. Admins see
 * everything; guests see the accounts they were granted; everyone else only
 * sees their own links. Write paths reject guests before using it.
 */
export function ownedByClause(actor: { id: string; role: string }) {
  if (actor.role === 'admin') return undefined
  if (isGuest(actor)) {
    return sql`${links.userId} in (select ${guestAccess.ownerId} from ${guestAccess} where ${guestAccess.guestId} = ${actor.id})`
  }
  return eq(links.userId, actor.id)
}

/** WHERE clause matching this id only if the actor may access it. */
export function accessibleById(id: string, actor: { id: string; role: string }) {
  const owned = ownedByClause(actor)
  return owned ? and(eq(links.id, id), owned) : eq(links.id, id)
}

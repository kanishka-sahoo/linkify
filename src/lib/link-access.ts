import { and, eq } from 'drizzle-orm'
import { links } from './schema'

// Kept apart from link-service: client routes import links.ts, which re-exports
// these, and link-service would pull node-only modules into the browser bundle.

/**
 * WHERE clause restricting links to those the actor may see. Admins see
 * everything; everyone else only sees their own links.
 */
export function ownedByClause(actor: { id: string; role: string }) {
  if (actor.role === 'admin') return undefined
  return eq(links.userId, actor.id)
}

/** WHERE clause matching this id only if the actor may access it. */
export function accessibleById(id: string, actor: { id: string; role: string }) {
  const owned = ownedByClause(actor)
  return owned ? and(eq(links.id, id), owned) : eq(links.id, id)
}

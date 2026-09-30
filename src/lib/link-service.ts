/**
 * Link operations for API-key callers (the REST API and the MCP server), so
 * both apply the same validation, ownership, rate limits, and audit logging.
 */
import { nanoid } from 'nanoid'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from './db'
import { clicks, links } from './schema'
import { hashPassword } from './keys'
import { hitLimit } from './ratelimit'
import { auditEvent } from './audit'
import { parseLinkInput, safeLink } from './link-domain'

export interface Actor {
  id: string
  role: string
}

/** How a write arrived, for the audit log: `api.link.created`, `mcp.link.created`, … */
export interface WriteContext {
  via: 'api' | 'mcp'
  keyId: string
  headers: Headers
}

/** A failure the caller should report to the client, with its HTTP status. */
export class LinkError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterSec?: number) {
    super(message)
  }
}

/**
 * WHERE clause restricting links to those the actor may see. Admins see
 * everything; everyone else only sees their own links.
 */
export function ownedByClause(actor: Actor) {
  if (actor.role === 'admin') return undefined
  return eq(links.userId, actor.id)
}

/** WHERE clause matching this id only if the actor may access it. */
export function accessibleById(id: string, actor: Actor) {
  const owned = ownedByClause(actor)
  return owned ? and(eq(links.id, id), owned) : eq(links.id, id)
}

const CREATE_LIMIT = 30
const CREATE_WINDOW_MS = 60 * 60 * 1000

function parse<T>(fn: () => T) {
  try {
    return fn()
  } catch (err) {
    throw new LinkError(err instanceof Error ? err.message : 'Invalid input', 400)
  }
}

export async function createLinkAs(actor: Actor, input: unknown, ctx: WriteContext) {
  const body = parse(() => parseLinkInput(input))
  const code = body.code ?? nanoid(7)
  const [existing] = await db.select({ id: links.id }).from(links).where(eq(links.code, code))
  if (existing) throw new LinkError(`code "${code}" is already taken`, 409)

  const { allowed, retryAfterSec } = await hitLimit(`create:${actor.id}`, CREATE_LIMIT, CREATE_WINDOW_MS)
  if (!allowed) {
    throw new LinkError('Rate limit reached — link creation is capped at 30/hour', 429, retryAfterSec)
  }

  const [row] = await db
    .insert(links)
    .values({
      id: nanoid(),
      code,
      url: body.url,
      title: body.title ?? null,
      tags: body.tags ?? [],
      status: body.status ?? 'active',
      startsAt: body.startsAt ? new Date(body.startsAt) : null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      expiredRedirectUrl: body.expiredRedirectUrl ?? null,
      maxClicks: body.maxClicks ?? null,
      privacyEnabled: body.privacyEnabled ?? false,
      passwordHash: body.password ? hashPassword(body.password) : null,
      userId: actor.id,
    })
    .returning()
  await auditEvent({
    action: `${ctx.via}.link.created`, actorUserId: actor.id, targetType: 'link', targetId: row.id,
    headers: ctx.headers, metadata: { keyId: ctx.keyId },
  })
  return safeLink(row)
}

/** Partial update: only fields present in `input` change; `password: null` removes protection. */
export async function updateLinkAs(actor: Actor, id: string, input: unknown, ctx: WriteContext) {
  const body = parse(() => parseLinkInput(input, true))
  const raw = input as Record<string, unknown>
  const [current] = await db.select().from(links).where(accessibleById(id, actor))
  if (!current) throw new LinkError('Not found', 404)
  if (body.code) {
    const [conflict] = await db
      .select({ id: links.id })
      .from(links)
      .where(and(eq(links.code, body.code), sql`${links.id} != ${id}`))
    if (conflict) throw new LinkError(`code "${body.code}" is already taken`, 409)
  }
  const has = (field: string) => Object.hasOwn(raw, field)
  const startsAt = has('startsAt')
    ? body.startsAt ? new Date(body.startsAt) : null
    : current.startsAt
  const expiresAt = has('expiresAt')
    ? body.expiresAt ? new Date(body.expiresAt) : null
    : current.expiresAt
  if (startsAt && expiresAt && startsAt >= expiresAt) {
    throw new LinkError('Expiry must be after the scheduled start', 400)
  }
  const [row] = await db
    .update(links)
    .set({
      ...(has('url') ? { url: body.url } : {}),
      ...(has('code') ? { code: body.code } : {}),
      ...(has('title') ? { title: body.title ?? null } : {}),
      ...(has('tags') ? { tags: body.tags ?? [] } : {}),
      ...(has('status') ? { status: body.status } : {}),
      ...(has('startsAt') ? { startsAt } : {}),
      ...(has('expiresAt') ? { expiresAt } : {}),
      ...(has('expiredRedirectUrl') ? { expiredRedirectUrl: body.expiredRedirectUrl ?? null } : {}),
      ...(has('maxClicks') ? { maxClicks: body.maxClicks ?? null } : {}),
      ...(has('privacyEnabled') ? { privacyEnabled: body.privacyEnabled ?? false } : {}),
      ...(has('password') ? { passwordHash: body.password ? hashPassword(body.password) : null } : {}),
      updatedAt: new Date(),
    })
    .where(accessibleById(id, actor))
    .returning()
  if (!row) throw new LinkError('Not found', 404)
  if (row.privacyEnabled && has('privacyEnabled')) {
    await db.update(clicks)
      .set({ ip: null, city: null, userAgent: null })
      .where(eq(clicks.linkId, row.id))
  }
  await auditEvent({
    action: `${ctx.via}.link.updated`, actorUserId: actor.id, targetType: 'link', targetId: row.id,
    headers: ctx.headers, metadata: { keyId: ctx.keyId },
  })
  return safeLink(row)
}

export async function deleteLinkAs(actor: Actor, id: string, ctx: WriteContext) {
  const [row] = await db
    .delete(links)
    .where(accessibleById(id, actor))
    .returning({ id: links.id })
  if (!row) throw new LinkError('Not found', 404)
  await auditEvent({
    action: `${ctx.via}.link.deleted`, actorUserId: actor.id, targetType: 'link', targetId: row.id,
    headers: ctx.headers, metadata: { keyId: ctx.keyId },
  })
  return { ok: true }
}

/** Link count, 30-day click totals, and top links across everything the actor can see. */
export async function overviewFor(actor: Actor) {
  const owned = ownedByClause(actor)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const [linkCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(links)
    .where(owned)
  // Click totals join links so non-admins only count their own links' clicks.
  const inRange = and(gte(clicks.timestamp, since), eq(clicks.outcome, 'redirected'))
  const clickQuery = db
    .select({
      total: sql<number>`count(*)::int`,
      bots: sql<number>`count(*) filter (where ${clicks.isBot})::int`,
      unique: sql<number>`count(distinct ${clicks.visitorHash}) filter (where not ${clicks.isBot})::int`,
    })
    .from(clicks)
    .$dynamic()
  const [clickTotals] = owned
    ? await clickQuery.innerJoin(links, eq(clicks.linkId, links.id)).where(and(inRange, owned))
    : await clickQuery.where(inRange)
  const topLinks = await db
    .select({ code: links.code, title: links.title, clicks: links.clickCount })
    .from(links)
    .where(owned)
    .orderBy(desc(links.clickCount))
    .limit(5)
  return {
    linkCount: linkCount.count,
    clicks30d: clickTotals.total,
    bots30d: clickTotals.bots,
    unique30d: clickTotals.unique,
    topLinks,
  }
}

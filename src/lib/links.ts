import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { nanoid } from 'nanoid'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from './db'
import { clicks, links, apiKeys } from './schema'
import { auth } from './auth'
import { generateApiKey, hashPassword } from './keys'
import { hitLimit } from './ratelimit'

async function requireUser() {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Unauthorized')
  return session.user
}

/**
 * WHERE clause restricting links to those the actor may see. Admins (and
 * actors with no id, i.e. legacy unowned API keys) see everything; everyone
 * else only their own links. Null userId rows are legacy admin-owned.
 */
export function ownedByClause(actor: { id: string | null; role: string }) {
  if (actor.role === 'admin' || !actor.id) return undefined
  return eq(links.userId, actor.id)
}

const CODE_RE = /^[a-zA-Z0-9_-]{1,64}$/

const MAX_TAGS = 10
const MAX_TAG_LEN = 32

/** Normalize user-supplied tags: lowercase, trimmed, deduped, capped. */
export function normalizeTags(tags?: string[] | null): string[] {
  if (!tags) return []
  const out: string[] = []
  for (const raw of tags) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, '-')
    if (!t) continue
    if (t.length > MAX_TAG_LEN) throw new Error(`Tags must be ${MAX_TAG_LEN} characters or fewer`)
    if (!out.includes(t)) out.push(t)
  }
  if (out.length > MAX_TAGS) throw new Error(`At most ${MAX_TAGS} tags per link`)
  return out
}

const CREATE_LIMIT = 30
const CREATE_WINDOW_MS = 60 * 60 * 1000

async function enforceCreateLimit(userId: string) {
  const { allowed, retryAfterSec } = await hitLimit(`create:${userId}`, CREATE_LIMIT, CREATE_WINDOW_MS)
  if (!allowed) {
    const mins = Math.ceil(retryAfterSec / 60)
    throw new Error(`Rate limit reached — you can create more links in ~${mins} min`)
  }
}

function validateUrl(url: string) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error()
    return u.toString()
  } catch {
    throw new Error('Invalid URL — must start with http:// or https://')
  }
}

function validateCode(code: string) {
  if (!CODE_RE.test(code)) {
    throw new Error('Code may only contain letters, numbers, dashes and underscores (max 64)')
  }
  const reserved = ['dashboard', 'login', 'setup', 'api']
  if (reserved.includes(code.toLowerCase())) throw new Error('That code is reserved')
  return code
}

export interface LinkInput {
  url: string
  code?: string
  title?: string
  tags?: string[]
  expiresAt?: string | null
  password?: string | null
}

export const listLinks = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser()
  const owned = ownedByClause(user)
  return db
    .select()
    .from(links)
    .where(owned)
    .orderBy(desc(links.createdAt))
})

export const createLink = createServerFn({ method: 'POST' })
  .validator((input: LinkInput) => input)
  .handler(async ({ data }) => {
    const user = await requireUser()
    await enforceCreateLimit(user.id)
    const url = validateUrl(data.url.trim())
    const code = data.code?.trim() ? validateCode(data.code.trim()) : nanoid(7)

    const [existing] = await db.select({ id: links.id }).from(links).where(eq(links.code, code))
    if (existing) throw new Error(`"${code}" is already taken`)

    const [row] = await db
      .insert(links)
      .values({
        id: nanoid(),
        code,
        url,
        title: data.title?.trim() || null,
        tags: normalizeTags(data.tags),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        passwordHash: data.password ? hashPassword(data.password) : null,
        userId: user.id,
      })
      .returning()
    return row
  })

export const updateLink = createServerFn({ method: 'POST' })
  .validator((input: { id: string } & LinkInput & { removePassword?: boolean }) => input)
  .handler(async ({ data }) => {
    const user = await requireUser()
    const owned = ownedByClause(user)
    const url = validateUrl(data.url.trim())
    const code = validateCode(data.code!.trim())

    const [conflict] = await db
      .select({ id: links.id })
      .from(links)
      .where(and(eq(links.code, code), sql`${links.id} != ${data.id}`))
    if (conflict) throw new Error(`"${code}" is already taken`)

    const [row] = await db
      .update(links)
      .set({
        url,
        code,
        title: data.title?.trim() || null,
        tags: normalizeTags(data.tags),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        ...(data.removePassword
          ? { passwordHash: null }
          : data.password
            ? { passwordHash: hashPassword(data.password) }
            : {}),
        updatedAt: new Date(),
      })
      .where(owned ? and(eq(links.id, data.id), owned) : eq(links.id, data.id))
      .returning()
    if (!row) throw new Error('Link not found')
    return row
  })

export const deleteLink = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireUser()
    const owned = ownedByClause(user)
    const [row] = await db
      .delete(links)
      .where(owned ? and(eq(links.id, data.id), owned) : eq(links.id, data.id))
      .returning({ id: links.id })
    if (!row) throw new Error('Link not found')
    return { ok: true }
  })

export const bulkDeleteLinks = createServerFn({ method: 'POST' })
  .validator((input: { ids: string[] }) => input)
  .handler(async ({ data }) => {
    const user = await requireUser()
    if (data.ids.length === 0) return { ok: true, count: 0 }
    const owned = ownedByClause(user)
    const rows = await db
      .delete(links)
      .where(owned ? and(inArray(links.id, data.ids), owned) : inArray(links.id, data.ids))
      .returning({ id: links.id })
    return { ok: true, count: rows.length }
  })

export const bulkExpireLinks = createServerFn({ method: 'POST' })
  .validator((input: { ids: string[] }) => input)
  .handler(async ({ data }) => {
    const user = await requireUser()
    if (data.ids.length === 0) return { ok: true, count: 0 }
    const owned = ownedByClause(user)
    const rows = await db
      .update(links)
      .set({ expiresAt: new Date(), updatedAt: new Date() })
      .where(owned ? and(inArray(links.id, data.ids), owned) : inArray(links.id, data.ids))
      .returning({ id: links.id })
    return { ok: true, count: rows.length }
  })

// ---------- analytics ----------

export const getLinkStats = createServerFn({ method: 'GET' })
  .validator((input: { code: string; days?: number }) => input)
  .handler(async ({ data }) => {
    const user = await requireUser()
    const owned = ownedByClause(user)
    const [link] = await db
      .select()
      .from(links)
      .where(owned ? and(eq(links.code, data.code), owned) : eq(links.code, data.code))
    if (!link) throw new Error('Link not found')

    const days = Math.min(Math.max(data.days ?? 30, 1), 365)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const [series, byCountry, byReferrer, byBrowser, byOs, byDevice, botSplit, recent] =
      await Promise.all([
        db
          .select({
            day: sql<string>`to_char(date_trunc('day', ${clicks.timestamp}), 'YYYY-MM-DD')`,
            count: sql<number>`count(*)::int`,
          })
          .from(clicks)
          .where(and(eq(clicks.linkId, link.id), gte(clicks.timestamp, since)))
          .groupBy(sql`date_trunc('day', ${clicks.timestamp})`)
          .orderBy(sql`date_trunc('day', ${clicks.timestamp})`),
        db
          .select({ name: clicks.country, count: sql<number>`count(*)::int` })
          .from(clicks)
          .where(and(eq(clicks.linkId, link.id), gte(clicks.timestamp, since)))
          .groupBy(clicks.country)
          .orderBy(desc(sql`count(*)`))
          .limit(12),
        db
          .select({ name: clicks.referrer, count: sql<number>`count(*)::int` })
          .from(clicks)
          .where(and(eq(clicks.linkId, link.id), gte(clicks.timestamp, since)))
          .groupBy(clicks.referrer)
          .orderBy(desc(sql`count(*)`))
          .limit(12),
        db
          .select({ name: clicks.browser, count: sql<number>`count(*)::int` })
          .from(clicks)
          .where(and(eq(clicks.linkId, link.id), gte(clicks.timestamp, since)))
          .groupBy(clicks.browser)
          .orderBy(desc(sql`count(*)`))
          .limit(8),
        db
          .select({ name: clicks.os, count: sql<number>`count(*)::int` })
          .from(clicks)
          .where(and(eq(clicks.linkId, link.id), gte(clicks.timestamp, since)))
          .groupBy(clicks.os)
          .orderBy(desc(sql`count(*)`))
          .limit(8),
        db
          .select({ name: clicks.deviceType, count: sql<number>`count(*)::int` })
          .from(clicks)
          .where(and(eq(clicks.linkId, link.id), gte(clicks.timestamp, since)))
          .groupBy(clicks.deviceType)
          .orderBy(desc(sql`count(*)`))
          .limit(8),
        db
          .select({ isBot: clicks.isBot, count: sql<number>`count(*)::int` })
          .from(clicks)
          .where(and(eq(clicks.linkId, link.id), gte(clicks.timestamp, since)))
          .groupBy(clicks.isBot),
        db
          .select()
          .from(clicks)
          .where(eq(clicks.linkId, link.id))
          .orderBy(desc(clicks.timestamp))
          .limit(100),
      ])

    const human = botSplit.find((b) => !b.isBot)?.count ?? 0
    const bots = botSplit.find((b) => b.isBot)?.count ?? 0

    return { link, series, byCountry, byReferrer, byBrowser, byOs, byDevice, human, bots, recent }
  })

export const getOverview = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser()
  const owned = ownedByClause(user)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const [linkCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(links)
    .where(owned)
  // Click totals join links so non-admins only count their own links' clicks.
  const clickQuery = db
    .select({
      total: sql<number>`count(*)::int`,
      bots: sql<number>`count(*) filter (where ${clicks.isBot})::int`,
    })
    .from(clicks)
    .$dynamic()
  const [clickTotals] = owned
    ? await clickQuery.innerJoin(links, eq(clicks.linkId, links.id)).where(and(gte(clicks.timestamp, since), owned))
    : await clickQuery.where(gte(clicks.timestamp, since))
  const topLinks = await db
    .select({ code: links.code, title: links.title, clicks: links.clickCount })
    .from(links)
    .where(owned)
    .orderBy(desc(links.clickCount))
    .limit(5)
  return { linkCount: linkCount.count, clicks30d: clickTotals.total, bots30d: clickTotals.bots, topLinks }
})

// ---------- api keys ----------

export const listApiKeys = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser()
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, user.id))
    .orderBy(desc(apiKeys.createdAt))
})

export const createApiKey = createServerFn({ method: 'POST' })
  .validator((input: { name: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireUser()
    if (!data.name?.trim()) throw new Error('Name is required')
    const { key, keyHash, keyPrefix } = generateApiKey()
    const [row] = await db
      .insert(apiKeys)
      .values({ id: nanoid(), name: data.name.trim(), keyHash, keyPrefix, userId: user.id })
      .returning()
    // Plaintext key is returned once and never stored.
    return { id: row.id, name: row.name, key }
  })

export const deleteApiKey = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireUser()
    await db.delete(apiKeys).where(and(eq(apiKeys.id, data.id), eq(apiKeys.userId, user.id)))
    return { ok: true }
  })

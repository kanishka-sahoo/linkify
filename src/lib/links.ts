import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { nanoid } from 'nanoid'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from './db'
import { clicks, links, apiKeys, user as userTable } from './schema'
import { auth } from './auth'
import { generateApiKey, hashPassword } from './keys'
import { API_SCOPES, type ApiScope } from './api-scopes'
import { hitLimit } from './ratelimit'
import { auditEvent } from './audit'
import { accountRestriction } from './account-policy'
import {
  normalizeTags, parseLinkInput, safeLink, validateCode,
} from './link-domain'
import { getClickStats } from './stats'
import { ownedByClause } from './link-access'
import { overviewFor } from './link-service'
import { parseClickLogCursor, parseClickLogFilter, queryClickLog } from './click-log'

export {
  MAX_LINK_PASSWORD_LEN, getLinkAvailability, normalizeTags, parseLinkInput,
  safeLink, validateCode, validateUrl,
} from './link-domain'
export type { LinkInput, LinkStatus, SafeLink } from './link-domain'
export { ownedByClause } from './link-access'

async function requireUser() {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Unauthorized')
  const restriction = accountRestriction(session.user)
  if (restriction) throw new Error(restriction)
  return session.user
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

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input')
  return input as Record<string, unknown>
}

function parseId(input: unknown) {
  const value = asObject(input)
  if (typeof value.id !== 'string' || !value.id || value.id.length > 128) throw new Error('Invalid id')
  return value.id
}

function parseIds(input: unknown) {
  const value = asObject(input)
  if (!Array.isArray(value.ids) || value.ids.length > 100) throw new Error('Provide at most 100 ids')
  if (value.ids.some((id) => typeof id !== 'string' || !id || id.length > 128)) throw new Error('Invalid id')
  return value.ids as string[]
}

export const listLinks = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser()
  const owned = ownedByClause(user)
  const rows = await db
    .select()
    .from(links)
    .where(owned)
    .orderBy(desc(links.createdAt))
  return rows.map(safeLink)
})

export const createLink = createServerFn({ method: 'POST' })
  .validator((input: unknown) => parseLinkInput(input))
  .handler(async ({ data }) => {
    const user = await requireUser()
    await enforceCreateLimit(user.id)
    const url = data.url
    const code = data.code ?? nanoid(7)

    const [existing] = await db.select({ id: links.id }).from(links).where(eq(links.code, code))
    if (existing) throw new Error(`"${code}" is already taken`)

    const [row] = await db
      .insert(links)
      .values({
        id: nanoid(),
        code,
        url,
        title: data.title ?? null,
        tags: normalizeTags(data.tags),
        status: data.status ?? 'active',
        startsAt: data.startsAt ? new Date(data.startsAt) : null,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        expiredRedirectUrl: data.expiredRedirectUrl ?? null,
        maxClicks: data.maxClicks ?? null,
        privacyEnabled: data.privacyEnabled ?? false,
        passwordHash: data.password ? hashPassword(data.password) : null,
        userId: user.id,
      })
      .returning()
    await auditEvent({
      action: 'link.created', actorUserId: user.id, targetType: 'link', targetId: row.id,
      headers: getRequestHeaders(),
    })
    return safeLink(row)
  })

export const updateLink = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const value = asObject(input)
    return {
      ...parseLinkInput(input),
      code: validateCode(value.code),
      id: parseId(input),
      removePassword: value.removePassword === true,
    }
  })
  .handler(async ({ data }) => {
    const user = await requireUser()
    const owned = ownedByClause(user)
    const url = data.url
    const code = data.code!

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
        title: data.title ?? null,
        tags: normalizeTags(data.tags),
        status: data.status ?? 'active',
        startsAt: data.startsAt ? new Date(data.startsAt) : null,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        expiredRedirectUrl: data.expiredRedirectUrl ?? null,
        maxClicks: data.maxClicks ?? null,
        privacyEnabled: data.privacyEnabled ?? false,
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
    if (row.privacyEnabled) {
      await db.update(clicks)
        .set({ ip: null, city: null, userAgent: null })
        .where(eq(clicks.linkId, row.id))
    }
    await auditEvent({
      action: 'link.updated', actorUserId: user.id, targetType: 'link', targetId: row.id,
      headers: getRequestHeaders(),
    })
    return safeLink(row)
  })

export const deleteLink = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ id: parseId(input) }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const owned = ownedByClause(user)
    const [row] = await db
      .delete(links)
      .where(owned ? and(eq(links.id, data.id), owned) : eq(links.id, data.id))
      .returning({ id: links.id })
    if (!row) throw new Error('Link not found')
    await auditEvent({
      action: 'link.deleted', actorUserId: user.id, targetType: 'link', targetId: row.id,
      headers: getRequestHeaders(),
    })
    return { ok: true }
  })

export const bulkDeleteLinks = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ ids: parseIds(input) }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    if (data.ids.length === 0) return { ok: true, count: 0 }
    const owned = ownedByClause(user)
    const rows = await db
      .delete(links)
      .where(owned ? and(inArray(links.id, data.ids), owned) : inArray(links.id, data.ids))
      .returning({ id: links.id })
    await auditEvent({
      action: 'link.bulk_deleted', actorUserId: user.id, targetType: 'link',
      headers: getRequestHeaders(), metadata: { ids: rows.map((row) => row.id) },
    })
    return { ok: true, count: rows.length }
  })

export const bulkExpireLinks = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ ids: parseIds(input) }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    if (data.ids.length === 0) return { ok: true, count: 0 }
    const owned = ownedByClause(user)
    const rows = await db
      .update(links)
      .set({ expiresAt: new Date(), updatedAt: new Date() })
      .where(owned ? and(inArray(links.id, data.ids), owned) : inArray(links.id, data.ids))
      .returning({ id: links.id })
    await auditEvent({
      action: 'link.bulk_expired', actorUserId: user.id, targetType: 'link',
      headers: getRequestHeaders(), metadata: { ids: rows.map((row) => row.id) },
    })
    return { ok: true, count: rows.length }
  })

export interface BulkLinkUpdateInput {
  ids: string[]
  status?: 'active' | 'paused'
  startsAt?: string | null
  expiresAt?: string | null
  addTags?: string[]
  removeTags?: string[]
  ownerId?: string
}

export const bulkUpdateLinks = createServerFn({ method: 'POST' })
  .validator((input: unknown): BulkLinkUpdateInput => {
    const value = asObject(input)
    const ids = parseIds(input)
    if (value.status !== undefined && value.status !== 'active' && value.status !== 'paused') {
      throw new Error('Invalid status')
    }
    const parsed = parseLinkInput({
      ...(value.startsAt !== undefined ? { startsAt: value.startsAt } : {}),
      ...(value.expiresAt !== undefined ? { expiresAt: value.expiresAt } : {}),
      ...(value.status !== undefined ? { status: value.status } : {}),
    }, true)
    const addTags = normalizeTags(Array.isArray(value.addTags) ? value.addTags as string[] : [])
    const removeTags = normalizeTags(Array.isArray(value.removeTags) ? value.removeTags as string[] : [])
    if (value.ownerId !== undefined && (typeof value.ownerId !== 'string' || !value.ownerId)) {
      throw new Error('Invalid owner')
    }
    if (!parsed.status && parsed.startsAt === undefined && parsed.expiresAt === undefined && addTags.length === 0 && removeTags.length === 0 && !value.ownerId) {
      throw new Error('Choose at least one bulk change')
    }
    return { ids, ...parsed, addTags, removeTags, ownerId: value.ownerId as string | undefined }
  })
  .handler(async ({ data }) => {
    const actor = await requireUser()
    if (data.ids.length === 0) return { ok: true, count: 0 }
    if (data.ownerId && actor.role !== 'admin') throw new Error('Only admins can transfer ownership')
    if (data.ownerId) {
      const [owner] = await db
        .select({ deactivatedAt: userTable.deactivatedAt })
        .from(userTable)
        .where(eq(userTable.id, data.ownerId))
      if (!owner) throw new Error('Owner not found')
      if (owner.deactivatedAt) throw new Error("Links can't be transferred to a deactivated account")
    }
    const owned = ownedByClause(actor)
    const rows = await db
      .select()
      .from(links)
      .where(owned ? and(inArray(links.id, data.ids), owned) : inArray(links.id, data.ids))

    await Promise.all(rows.map((row) => {
      const removed = new Set(data.removeTags)
      const tags = normalizeTags([...row.tags.filter((tag) => !removed.has(tag)), ...(data.addTags ?? [])])
      const startsAt = data.startsAt === undefined ? row.startsAt : data.startsAt ? new Date(data.startsAt) : null
      const expiresAt = data.expiresAt === undefined ? row.expiresAt : data.expiresAt ? new Date(data.expiresAt) : null
      if (startsAt && expiresAt && startsAt >= expiresAt) throw new Error(`/${row.code}: expiry must be after the scheduled start`)
      return db.update(links).set({
        ...(data.status ? { status: data.status } : {}),
        ...(data.startsAt !== undefined ? { startsAt } : {}),
        ...(data.expiresAt !== undefined ? { expiresAt } : {}),
        ...(data.ownerId ? { userId: data.ownerId } : {}),
        tags,
        updatedAt: new Date(),
      }).where(eq(links.id, row.id))
    }))
    await auditEvent({
      action: 'link.bulk_updated', actorUserId: actor.id, targetType: 'link',
      headers: getRequestHeaders(), metadata: { ids: rows.map((row) => row.id), ownerId: data.ownerId },
    })
    return { ok: true, count: rows.length }
  })

type ImportConflictMode = 'skip' | 'replace' | 'generate'

export const importLinks = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const value = asObject(input)
    if (!Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > 200) {
      throw new Error('Import between 1 and 200 links at a time')
    }
    if (value.conflict !== 'skip' && value.conflict !== 'replace' && value.conflict !== 'generate') {
      throw new Error('Invalid conflict mode')
    }
    return { rows: value.rows as unknown[], conflict: value.conflict as ImportConflictMode }
  })
  .handler(async ({ data }) => {
    const actor = await requireUser()
    const gate = await hitLimit(`import:${actor.id}`, 3, 60 * 60 * 1000)
    if (!gate.allowed) throw new Error('Import limit reached — try again later')

    let created = 0
    let updated = 0
    let skipped = 0
    const errors: { row: number; message: string }[] = []
    for (let index = 0; index < data.rows.length; index += 1) {
      const raw = data.rows[index]
      try {
        const input = parseLinkInput(raw)
        let code = input.code ?? nanoid(7)
        let [existing] = await db.select().from(links).where(eq(links.code, code))
        if (existing && data.conflict === 'generate') {
          do {
            code = nanoid(7)
            ;[existing] = await db.select().from(links).where(eq(links.code, code))
          } while (existing)
        }
        if (existing && data.conflict === 'skip') {
          skipped += 1
          continue
        }
        const values = {
          url: input.url,
          code,
          title: input.title ?? null,
          tags: normalizeTags(input.tags),
          status: input.status ?? 'active',
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          expiredRedirectUrl: input.expiredRedirectUrl ?? null,
          maxClicks: input.maxClicks ?? null,
          privacyEnabled: input.privacyEnabled ?? false,
          ...(input.password ? { passwordHash: hashPassword(input.password) } : {}),
          updatedAt: new Date(),
        }
        if (existing) {
          const owned = ownedByClause(actor)
          if (owned && existing.userId !== actor.id) {
            skipped += 1
            errors.push({ row: index + 2, message: `/${code} belongs to another user` })
            continue
          }
          await db.update(links).set(values).where(eq(links.id, existing.id))
          if (input.privacyEnabled) {
            await db.update(clicks)
              .set({ ip: null, city: null, userAgent: null })
              .where(eq(clicks.linkId, existing.id))
          }
          updated += 1
        } else {
          await db.insert(links).values({ id: nanoid(), userId: actor.id, ...values })
          created += 1
        }
      } catch (error) {
        errors.push({ row: index + 2, message: error instanceof Error ? error.message : 'Invalid row' })
      }
    }
    await auditEvent({
      action: 'link.imported', actorUserId: actor.id, targetType: 'link', headers: getRequestHeaders(),
      metadata: { created, updated, skipped, errors: errors.length },
    })
    return { created, updated, skipped, errors }
  })

// ---------- analytics ----------

/**
 * The link with this code if the current user may view it. Invalid, unknown,
 * and other users' codes all throw notFound() so existence isn't leaked.
 */
async function viewableLink(rawCode: string) {
  const user = await requireUser()
  let code: string
  try {
    code = validateCode(rawCode)
  } catch {
    throw notFound()
  }
  const owned = ownedByClause(user)
  const [link] = await db
    .select()
    .from(links)
    .where(owned ? and(eq(links.code, code), owned) : eq(links.code, code))
  if (!link) throw notFound()
  return link
}

export const getLinkStats = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const value = asObject(input)
    return {
      code: typeof value.code === 'string' ? value.code : '',
      days: typeof value.days === 'number' && Number.isFinite(value.days) ? value.days : undefined,
    }
  })
  .handler(async ({ data }) => {
    const link = await viewableLink(data.code)
    const days = Math.min(Math.max(data.days ?? 30, 1), 365)
    const stats = await getClickStats(link.id, days)
    const { country, referrer, browser, os, device } = stats.breakdowns

    return {
      link: safeLink(link),
      series: stats.series,
      byCountry: country.slice(0, 12),
      byReferrer: referrer.slice(0, 12),
      byBrowser: browser.slice(0, 8),
      byOs: os.slice(0, 8),
      byDevice: device.slice(0, 8),
      human: stats.human,
      bots: stats.bots,
      uniqueVisitors: stats.uniqueVisitors,
      outcomes: stats.outcomes,
    }
  })

export const CLICK_LOG_PAGE_SIZE = 25

/** A page of the link's click log, newest first. Pass the previous page's `nextCursor` to continue. */
export const getClickLog = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const value = asObject(input)
    return {
      code: typeof value.code === 'string' ? value.code : '',
      filter: parseClickLogFilter(value),
      cursor: parseClickLogCursor(value.cursor),
    }
  })
  .handler(async ({ data }) => {
    const link = await viewableLink(data.code)
    return queryClickLog(link.id, data.filter, data.cursor, CLICK_LOG_PAGE_SIZE)
  })

export const getOverview = createServerFn({ method: 'GET' }).handler(async () => {
  return overviewFor(await requireUser())
})

// ---------- api keys ----------

export const createApiKey = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input')
    const value = input as Record<string, unknown>
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('Name is required')
    const expiresInDays = value.expiresInDays === undefined ? 90 : Number(value.expiresInDays)
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) {
      throw new Error('Expiry must be between 1 and 365 days')
    }
    const scopes = value.scopes === undefined ? [...API_SCOPES] : value.scopes
    if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some((scope) => !API_SCOPES.includes(scope as ApiScope))) {
      throw new Error('Select at least one valid API scope')
    }
    return { name: value.name, expiresInDays, scopes: [...new Set(scopes)] as ApiScope[] }
  })
  .handler(async ({ data }) => {
    const user = await requireUser()
    const [{ value: keyCount }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(apiKeys)
      .where(eq(apiKeys.userId, user.id))
    if (keyCount >= 20) throw new Error('Delete an existing API key before creating another')
    const { key, keyHash, keyPrefix } = generateApiKey()
    const expiresAt = new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000)
    const [row] = await db
      .insert(apiKeys)
      .values({
        id: nanoid(), name: data.name.trim(), keyHash, keyPrefix, userId: user.id,
        scopes: data.scopes, expiresAt,
      })
      .returning()
    await auditEvent({
      action: 'api_key.created', actorUserId: user.id, targetType: 'api_key', targetId: row.id,
      headers: getRequestHeaders(), metadata: { expiresInDays: data.expiresInDays },
    })
    // Plaintext key is returned once and never stored.
    return { id: row.id, name: row.name, key }
  })

export const deleteApiKey = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input')
    const id = (input as Record<string, unknown>).id
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid API key')
    return { id }
  })
  .handler(async ({ data }) => {
    const user = await requireUser()
    await db.delete(apiKeys).where(and(eq(apiKeys.id, data.id), eq(apiKeys.userId, user.id)))
    await auditEvent({
      action: 'api_key.deleted', actorUserId: user.id, targetType: 'api_key', targetId: data.id,
      headers: getRequestHeaders(),
    })
    return { ok: true }
  })

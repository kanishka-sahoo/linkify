/** Linkify's MCP tools: link management and analytics for the holder of an API key. */
import { and, desc, eq, or } from 'drizzle-orm'
import { db } from './db'
import { links, type Link } from './schema'
import type { ApiScope } from './api-scopes'
import { getClickStats } from './stats'
import { parseClickLogCursor, parseClickLogFilter, queryClickLog } from './click-log'
import { getLinkAvailability, normalizeTags, safeLink } from './link-domain'
import {
  LinkError, createLinkAs, deleteLinkAs, overviewFor, ownedByClause, updateLinkAs, type Actor,
} from './link-service'
import { ToolError, type McpServer, type McpTool } from './mcp-protocol'

export interface McpContext {
  actor: Actor
  keyId: string
  scopes: string[]
  headers: Headers
}

const LINK_STATES = ['active', 'paused', 'scheduled', 'expired', 'limit-reached'] as const

function shortUrl(code: string) {
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000'
  return `${base.replace(/\/+$/, '')}/${code}`
}

/** A link as tools return it: never the password hash, plus its short URL and current state. */
function present(row: Link) {
  return { ...safeLink(row), shortUrl: shortUrl(row.code), state: getLinkAvailability(row).state }
}

/** The link whose id or code is `ref`, if the actor may see it. An id match wins over a code match. */
async function resolveLink(ctx: McpContext, ref: unknown) {
  if (typeof ref !== 'string' || !ref || ref.length > 128) throw new ToolError('`link` must be a link id or short code')
  const owned = ownedByClause(ctx.actor)
  const match = or(eq(links.id, ref), eq(links.code, ref))
  const rows = await db.select().from(links).where(owned ? and(match, owned) : match)
  const row = rows.find((r) => r.id === ref) ?? rows[0]
  if (!row) throw new ToolError(`No link "${ref}" found`)
  return row
}

function intArg(args: Record<string, unknown>, name: string, fallback: number, min: number, max: number) {
  const value = args[name]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ToolError(`\`${name}\` must be a whole number from ${min} to ${max}`)
  }
  return value
}

function optionalString(args: Record<string, unknown>, name: string, max: number) {
  const value = args[name]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > max) throw new ToolError(`\`${name}\` must be text up to ${max} characters`)
  return value
}

/** Runs a link-service call, turning its client errors into tool errors the model can act on. */
async function linkCall<T>(fn: () => Promise<T>) {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof LinkError) {
      throw new ToolError(err.retryAfterSec === undefined ? err.message : `${err.message}; retry in ${err.retryAfterSec}s`)
    }
    throw err
  }
}

const writeContext = (ctx: McpContext) => ({ via: 'mcp' as const, keyId: ctx.keyId, headers: ctx.headers })

const linkRef = {
  type: 'string',
  description: 'The link to act on: its id or its short code (the part after the domain).',
}

/** Nullable via anyOf rather than `type: [..., 'null']`, which single-type schema dialects (e.g. Gemini) reject. */
const nullable = (schema: Record<string, unknown>, description: string) =>
  ({ anyOf: [schema, { type: 'null' }], description })

const linkFields = {
  url: { type: 'string', description: 'Destination URL (http or https).' },
  code: { type: 'string', description: 'Short code: letters, numbers, - and _, up to 64. Random when omitted on create.' },
  title: nullable({ type: 'string' }, 'Label shown in the dashboard, up to 200 characters.'),
  tags: { type: 'array', items: { type: 'string' }, description: 'Up to 10 tags; lowercased and deduplicated.' },
  status: { type: 'string', enum: ['active', 'paused'], description: 'Paused links stop redirecting.' },
  startsAt: nullable({ type: 'string', format: 'date-time' }, 'ISO time the link starts redirecting.'),
  expiresAt: nullable({ type: 'string', format: 'date-time' }, 'ISO time the link stops redirecting.'),
  expiredRedirectUrl: nullable(
    { type: 'string' },
    'Where visitors go while the link is paused, scheduled, expired, or at its click limit.',
  ),
  maxClicks: nullable({ type: 'integer', minimum: 1 }, 'Stop redirecting after this many clicks.'),
  privacyEnabled: { type: 'boolean', description: 'Stop recording IP, city, and user agent for visits.' },
  password: nullable({ type: 'string' }, 'Visitors must enter this password. On update, null removes it.'),
}

type Tool = McpTool<McpContext>

function scoped(scope: ApiScope): Pick<Tool, 'allowed' | 'deniedMessage'> {
  return {
    allowed: (ctx) => ctx.scopes.includes(scope),
    deniedMessage: `This API key lacks the ${scope} scope. Create a key with it in Settings → API keys.`,
  }
}

const tools: Tool[] = [
  {
    name: 'list_links',
    title: 'List links',
    description:
      'List short links, newest first. Filter by free-text query (matches code, URL, title, tags), tag, or state. '
      + 'Returns `total` matches and one page of links.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive text to find in code, URL, title, or tags.' },
        tag: { type: 'string', description: 'Only links with this tag.' },
        state: { type: 'string', enum: [...LINK_STATES], description: 'Only links currently in this state.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        offset: { type: 'integer', minimum: 0, default: 0 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    ...scoped('links:read'),
    async call(args, ctx) {
      const query = optionalString(args, 'query', 200)?.toLowerCase()
      const tagArg = optionalString(args, 'tag', 64)
      let tag: string | undefined
      try {
        tag = tagArg === undefined ? undefined : normalizeTags([tagArg])[0]
      } catch (err) {
        throw new ToolError(err instanceof Error ? err.message : 'Invalid tag')
      }
      const state = args.state
      if (state !== undefined && !LINK_STATES.includes(state as never)) {
        throw new ToolError(`\`state\` must be one of ${LINK_STATES.join(', ')}`)
      }
      const limit = intArg(args, 'limit', 50, 1, 200)
      const offset = intArg(args, 'offset', 0, 0, 1_000_000)
      const rows = await db.select().from(links).where(ownedByClause(ctx.actor)).orderBy(desc(links.createdAt))
      const matches = rows.map(present).filter((link) =>
        (!query || [link.code, link.url, link.title ?? '', ...link.tags].some((v) => v.toLowerCase().includes(query)))
        && (!tag || link.tags.includes(tag))
        && (!state || link.state === state))
      return { total: matches.length, offset, links: matches.slice(offset, offset + limit) }
    },
  },
  {
    name: 'get_link',
    title: 'Get link',
    description: 'Get one link by id or short code, including its short URL, state, and all-time click count.',
    inputSchema: {
      type: 'object',
      properties: { link: linkRef },
      required: ['link'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    ...scoped('links:read'),
    async call(args, ctx) {
      return present(await resolveLink(ctx, args.link))
    },
  },
  {
    name: 'create_link',
    title: 'Create link',
    description: 'Create a short link. Only `url` is required. Creation is capped at 30 links per hour per user.',
    inputSchema: {
      type: 'object',
      properties: linkFields,
      required: ['url'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    ...scoped('links:write'),
    async call(args, ctx) {
      const link = await linkCall(() => createLinkAs(ctx.actor, args, writeContext(ctx)))
      return { ...link, shortUrl: shortUrl(link.code), state: getLinkAvailability(link).state }
    },
  },
  {
    name: 'update_link',
    title: 'Update link',
    description:
      'Change some fields of a link; fields you omit are left alone. Use `status` to pause or resume, '
      + '`code` to rename, null to clear an optional field, and `password: null` to remove password protection.',
    inputSchema: {
      type: 'object',
      properties: { link: linkRef, ...linkFields },
      required: ['link'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    ...scoped('links:write'),
    async call(args, ctx) {
      const { link: ref, ...fields } = args
      const current = await resolveLink(ctx, ref)
      const link = await linkCall(() => updateLinkAs(ctx.actor, current.id, fields, writeContext(ctx)))
      return { ...link, shortUrl: shortUrl(link.code), state: getLinkAvailability(link).state }
    },
  },
  {
    name: 'delete_link',
    title: 'Delete link',
    description: 'Permanently delete a link and all of its analytics. The short URL stops working.',
    inputSchema: {
      type: 'object',
      properties: { link: linkRef },
      required: ['link'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    ...scoped('links:write'),
    async call(args, ctx) {
      const current = await resolveLink(ctx, args.link)
      await linkCall(() => deleteLinkAs(ctx.actor, current.id, writeContext(ctx)))
      return { deleted: true, id: current.id, code: current.code }
    },
  },
  {
    name: 'get_link_stats',
    title: 'Get link analytics',
    description:
      'Analytics for one link over the last `days` UTC days: daily clicks and unique visitors, human vs bot clicks, '
      + 'visit outcomes (redirected, fallback, blocked, password_failed), and top countries, referrers, browsers, '
      + 'operating systems, and devices. A null name means unknown (for referrers: direct traffic).',
    inputSchema: {
      type: 'object',
      properties: {
        link: linkRef,
        days: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
      },
      required: ['link'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    ...scoped('stats:read'),
    async call(args, ctx) {
      const days = intArg(args, 'days', 30, 1, 365)
      const link = await resolveLink(ctx, args.link)
      const stats = await getClickStats(link.id, days)
      const { country, referrer, browser, os, device } = stats.breakdowns
      return {
        link: { id: link.id, code: link.code, url: link.url, shortUrl: shortUrl(link.code) },
        days,
        totalClicksAllTime: link.clickCount,
        human: stats.human,
        bots: stats.bots,
        uniqueVisitors: stats.uniqueVisitors,
        outcomes: stats.outcomes,
        series: stats.series,
        byCountry: country.slice(0, 20),
        byReferrer: referrer.slice(0, 20),
        byBrowser: browser.slice(0, 10),
        byOs: os.slice(0, 10),
        byDevice: device.slice(0, 10),
      }
    },
  },
  {
    name: 'get_click_log',
    title: 'Get click log',
    description:
      'Individual visits to a link, newest first. Pass the returned `nextCursor` to get the next page; it is null '
      + 'on the last page. Links in privacy mode never include IP, city, or user agent.',
    inputSchema: {
      type: 'object',
      properties: {
        link: linkRef,
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        humansOnly: { type: 'boolean', description: 'Exclude bot visits.' },
        country: { type: 'string', description: 'ISO country code to filter by; empty string for unknown country.' },
        cursor: {
          type: 'object',
          properties: { ts: { type: 'string' }, id: { type: 'string' } },
          description: 'The `nextCursor` from the previous page.',
        },
      },
      required: ['link'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    ...scoped('stats:read'),
    async call(args, ctx) {
      const limit = intArg(args, 'limit', 25, 1, 100)
      if (args.cursor !== undefined && !parseClickLogCursor(args.cursor)) throw new ToolError('Invalid `cursor`')
      const link = await resolveLink(ctx, args.link)
      const page = await queryClickLog(link.id, parseClickLogFilter(args), parseClickLogCursor(args.cursor), limit)
      return {
        link: { id: link.id, code: link.code },
        clicks: page.clicks.map((c) => ({
          timestamp: c.timestamp.toISOString(),
          outcome: c.outcome,
          country: c.country,
          city: link.privacyEnabled ? null : c.city,
          referrer: c.referrer,
          browser: c.browser,
          os: c.os,
          device: c.deviceType,
          isBot: c.isBot,
          ip: link.privacyEnabled ? null : c.ip,
          userAgent: link.privacyEnabled ? null : c.userAgent,
        })),
        nextCursor: page.nextCursor,
      }
    },
  },
  {
    name: 'get_analytics_overview',
    title: 'Get analytics overview',
    description:
      'Totals across all links you can access: link count, clicks, bot clicks, and unique human visitors over the '
      + 'last 30 days, plus the 5 links with the most clicks of all time.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    ...scoped('stats:read'),
    async call(_args, ctx) {
      const overview = await overviewFor(ctx.actor)
      return { ...overview, topLinks: overview.topLinks.map((l) => ({ ...l, shortUrl: shortUrl(l.code) })) }
    },
  },
]

export const linkifyMcpServer: McpServer<McpContext> = {
  name: 'linkify',
  version: '1.0.0',
  instructions:
    'Linkify is a URL shortener. Use these tools to create, find, edit, pause, and delete short links and to read '
    + 'their click analytics. Links are referred to by id or short code. Admin keys see every user\'s links; other '
    + 'keys see only their own. Times are ISO 8601 and analytics days are UTC.',
  tools,
}

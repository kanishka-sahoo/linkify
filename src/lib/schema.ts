import { sql } from 'drizzle-orm'
import type { ClickOutcome } from './click-stats'
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  index,
  uniqueIndex,
  date,
  primaryKey,
} from 'drizzle-orm/pg-core'

// ---------- better-auth core tables ----------

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    role: text('role').notNull().default('user'),
    twoFactorEnabled: boolean('two_factor_enabled').default(false),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    // Only the account created through first-run setup receives this marker.
    // The partial unique index makes concurrent bootstrap requests atomic.
    bootstrapOwner: boolean('bootstrap_owner').notNull().default(false),
    // Set when an admin leaves. The account can't sign in, but keeps its links
    // (which still redirect) until another admin takes them over.
    deactivatedAt: timestamp('deactivated_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_single_bootstrap_owner_idx')
      .on(t.bootstrapOwner)
      .where(sql`${t.bootstrapOwner} = true`),
  ],
)

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const twoFactor = pgTable('two_factor', {
  id: text('id').primaryKey(),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  verified: boolean('verified').default(true),
  failedVerificationCount: integer('failed_verification_count').default(0),
  lockedUntil: timestamp('locked_until'),
})

export const passkey = pgTable('passkey', {
  id: text('id').primaryKey(),
  name: text('name'),
  publicKey: text('public_key').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  credentialID: text('credential_id').notNull(),
  counter: integer('counter').notNull(),
  deviceType: text('device_type').notNull(),
  backedUp: boolean('backed_up').notNull(),
  transports: text('transports'),
  createdAt: timestamp('created_at').defaultNow(),
  aaguid: text('aaguid'),
})

// ---------- app tables ----------

export const links = pgTable(
  'links',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(),
    url: text('url').notNull(),
    title: text('title'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    passwordHash: text('password_hash'),
    status: text('status').notNull().default('active'),
    startsAt: timestamp('starts_at'),
    expiresAt: timestamp('expires_at'),
    expiredRedirectUrl: text('expired_redirect_url'),
    maxClicks: integer('max_clicks'),
    privacyEnabled: boolean('privacy_enabled').notNull().default(false),
    clickCount: integer('click_count').notNull().default(0),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('links_code_idx').on(t.code), index('links_user_idx').on(t.userId)],
)

export const clicks = pgTable(
  'clicks',
  {
    id: text('id').primaryKey(),
    linkId: text('link_id')
      .notNull()
      .references(() => links.id, { onDelete: 'cascade' }),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
    ip: text('ip'),
    country: text('country'),
    city: text('city'),
    userAgent: text('user_agent'),
    browser: text('browser'),
    os: text('os'),
    deviceType: text('device_type'),
    isBot: boolean('is_bot').notNull().default(false),
    referrer: text('referrer'),
    visitorHash: text('visitor_hash'),
    /** A ClickOutcome; only `redirected` clicks count toward `links.clickCount` and breakdowns. */
    outcome: text('outcome').$type<ClickOutcome>().notNull().default('redirected'),
  },
  (t) => [
    index('clicks_link_ts_idx').on(t.linkId, t.timestamp),
    index('clicks_link_visitor_idx').on(t.linkId, t.visitorHash),
  ],
)

/**
 * Per-day click counts, rolled up from `clicks` by the cleanup cron so long
 * ranges don't scan raw clicks. `dimension` is a breakdown from click-stats.ts
 * (redirected clicks only), `outcome` (all clicks), or `unique` (distinct
 * human visitors that day); `value` is '' for null.
 * Days from max(day) + 1 onward haven't been rolled up and are read from
 * `clicks` instead.
 */
export const clickDaily = pgTable(
  'click_daily',
  {
    linkId: text('link_id')
      .notNull()
      .references(() => links.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    dimension: text('dimension').notNull(),
    value: text('value').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.linkId, t.day, t.dimension, t.value] }),
    index('click_daily_day_idx').on(t.day),
  ],
)

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  keyPrefix: text('key_prefix').notNull(),
  scopes: text('scopes')
    .array()
    .notNull()
    .default(sql`array['links:read', 'links:write', 'stats:read']::text[]`),
  expiresAt: timestamp('expires_at').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
})

// Better Auth's distributed rate-limit store. This is separate from the
// application's fixed-window counters because Better Auth uses epoch millis.
export const authRateLimit = pgTable('auth_rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})

// Fixed-window rate limit counters, e.g. 'pw:<linkId>:<ipHash>' or 'create:<userId>'.
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: timestamp('reset_at').notNull(),
})

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    action: text('action').notNull(),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_logs_created_at_idx').on(t.createdAt), index('audit_logs_actor_idx').on(t.actorUserId)],
)

export type Link = typeof links.$inferSelect
export type Click = typeof clicks.$inferSelect
export type ApiKey = typeof apiKeys.$inferSelect
export type AuditLog = typeof auditLogs.$inferSelect

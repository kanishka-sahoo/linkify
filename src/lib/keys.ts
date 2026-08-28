import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { db } from './db'
import { apiKeys, user } from './schema'
import { eq } from 'drizzle-orm'
import { isIP } from 'node:net'
import { hitLimit } from './ratelimit'
import type { ApiScope } from './api-scopes'
import { accountRestriction } from './account-policy'

export function sha256(input: string) {
  return createHash('sha256').update(input).digest('hex')
}

/** Generate a new API key. Returns the plaintext key (shown once) plus the row data. */
export function generateApiKey() {
  const key = `lk_${randomBytes(24).toString('hex')}`
  return { key, keyHash: sha256(key), keyPrefix: key.slice(0, 10) }
}

/** Client IP as seen by the app (Vercel/proxy headers first). */
export function clientIp(request: Request) {
  const value = request.headers.get(process.env.TRUSTED_IP_HEADER ?? 'x-real-ip')?.trim() ?? null
  return value && isIP(value) ? value : null
}

/**
 * Resolve a Bearer token to its API key row plus the owner's role, updating
 * lastUsedAt. Expired or orphaned credentials are rejected, as are keys whose
 * owner is restricted (deactivated, temporary password, or an admin without TOTP).
 */
export async function resolveApiKey(request: Request) {
  const header = request.headers.get('authorization')
  const match = header?.match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const hash = sha256(match[1].trim())
  const [row] = await db
    .select({
      key: apiKeys,
      role: user.role,
      twoFactorEnabled: user.twoFactorEnabled,
      mustChangePassword: user.mustChangePassword,
      deactivatedAt: user.deactivatedAt,
    })
    .from(apiKeys)
    .leftJoin(user, eq(apiKeys.userId, user.id))
    .where(eq(apiKeys.keyHash, hash))
  if (!row || !row.key.userId || !row.role || row.key.expiresAt <= new Date()) return null
  if (accountRestriction({ ...row, role: row.role })) return null
  const limit = await hitLimit(`api:${row.key.id}`, 600, 60 * 1000)
  if (!limit.allowed) return null
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.key.id))
    .execute()
    .catch(() => {})
  return { ...row.key, role: row.role }
}

export function hasApiScope(key: { scopes: string[] }, scope: ApiScope) {
  return key.scopes.includes(scope)
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

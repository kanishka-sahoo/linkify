import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { db } from './db'
import { apiKeys, user } from './schema'
import { eq } from 'drizzle-orm'

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
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null
  )
}

/**
 * Resolve a Bearer token to its api key row plus the owner's role, updating
 * lastUsedAt. Keys with no owner (pre-ownership rows not yet backfilled) are
 * treated as admin-owned.
 */
export async function resolveApiKey(request: Request) {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const hash = sha256(header.slice(7).trim())
  const [row] = await db
    .select({ key: apiKeys, role: user.role })
    .from(apiKeys)
    .leftJoin(user, eq(apiKeys.userId, user.id))
    .where(eq(apiKeys.keyHash, hash))
  if (!row) return null
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.key.id))
    .execute()
    .catch(() => {})
  return { ...row.key, role: row.role ?? 'admin' }
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

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { db } from './db'
import { apiKeys } from './schema'
import { eq } from 'drizzle-orm'

export function sha256(input: string) {
  return createHash('sha256').update(input).digest('hex')
}

/** Generate a new API key. Returns the plaintext key (shown once) plus the row data. */
export function generateApiKey() {
  const key = `lk_${randomBytes(24).toString('hex')}`
  return { key, keyHash: sha256(key), keyPrefix: key.slice(0, 10) }
}

/** Resolve a Bearer token to an api key row, updating lastUsedAt. */
export async function resolveApiKey(request: Request) {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const hash = sha256(header.slice(7).trim())
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash))
  if (!row) return null
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .execute()
    .catch(() => {})
  return row
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

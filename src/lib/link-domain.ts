import type { Link } from './schema'

const CODE_RE = /^[a-zA-Z0-9_-]{1,64}$/
const MAX_URL_LEN = 2_048
const MAX_TITLE_LEN = 200
const MAX_TAGS = 10
const MAX_TAG_LEN = 32
export const MAX_LINK_PASSWORD_LEN = 128

export type LinkStatus = 'active' | 'paused'

export interface LinkInput {
  url: string
  code?: string
  title?: string | null
  tags?: string[]
  status?: LinkStatus
  startsAt?: string | null
  expiresAt?: string | null
  expiredRedirectUrl?: string | null
  maxClicks?: number | null
  privacyEnabled?: boolean
  password?: string | null
}

export type SafeLink = Omit<Link, 'passwordHash'> & { passwordProtected: boolean }

export type LinkAvailability =
  | { state: 'active' }
  | { state: 'paused' | 'scheduled' | 'expired' | 'limit-reached'; fallbackUrl: string | null }

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input')
  return input as Record<string, unknown>
}

/** Normalize user-supplied tags: lowercase, trimmed, deduped, capped. */
export function normalizeTags(tags?: string[] | null): string[] {
  if (!tags) return []
  const out: string[] = []
  for (const raw of tags) {
    if (typeof raw !== 'string') throw new Error('Tags must be strings')
    const tag = raw.trim().toLowerCase().replace(/\s+/g, '-')
    if (!tag) continue
    if (tag.length > MAX_TAG_LEN) throw new Error(`Tags must be ${MAX_TAG_LEN} characters or fewer`)
    if (!out.includes(tag)) out.push(tag)
  }
  if (out.length > MAX_TAGS) throw new Error(`At most ${MAX_TAGS} tags per link`)
  return out
}

export function validateUrl(url: unknown) {
  if (typeof url !== 'string' || !url.trim() || url.length > MAX_URL_LEN) {
    throw new Error(`URL is required and must be ${MAX_URL_LEN} characters or fewer`)
  }
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
    return parsed.toString()
  } catch {
    throw new Error('Invalid URL — must start with http:// or https://')
  }
}

export function validateCode(code: unknown) {
  if (typeof code !== 'string') throw new Error('Code is required')
  if (!CODE_RE.test(code)) {
    throw new Error('Code may only contain letters, numbers, dashes and underscores (max 64)')
  }
  if (['dashboard', 'login', 'setup', 'api'].includes(code.toLowerCase())) {
    throw new Error('That code is reserved')
  }
  return code
}

function validateTitle(title: unknown): string | null {
  if (title === undefined || title === null || title === '') return null
  if (typeof title !== 'string' || title.length > MAX_TITLE_LEN) {
    throw new Error(`Title must be ${MAX_TITLE_LEN} characters or fewer`)
  }
  return title.trim() || null
}

function validatePassword(password: unknown): string | null | undefined {
  if (password === undefined) return undefined
  if (password === null || password === '') return null
  if (typeof password !== 'string' || password.length > MAX_LINK_PASSWORD_LEN) {
    throw new Error(`Password must be ${MAX_LINK_PASSWORD_LEN} characters or fewer`)
  }
  return password
}

function validateDate(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${label} must be an ISO date string`)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date`)
  return date.toISOString()
}

function validateOptionalUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  return validateUrl(value)
}

function validateMaxClicks(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000_000) {
    throw new Error('Click limit must be a whole number between 1 and 1,000,000,000')
  }
  return parsed
}

export function parseLinkInput(input: unknown, partial = false): LinkInput {
  const value = asObject(input)
  const out: Partial<LinkInput> = {}
  if (!partial || value.url !== undefined) out.url = validateUrl(value.url)
  if (!partial || value.code !== undefined) {
    if (!partial && (value.code === undefined || value.code === '')) out.code = undefined
    else out.code = validateCode(value.code)
  }
  if (!partial || value.title !== undefined) out.title = validateTitle(value.title)
  if (!partial || value.tags !== undefined) {
    if (value.tags !== undefined && !Array.isArray(value.tags)) throw new Error('Tags must be an array')
    out.tags = normalizeTags(value.tags as string[] | null | undefined)
  }
  if (!partial || value.status !== undefined) {
    if (value.status !== undefined && value.status !== 'active' && value.status !== 'paused') {
      throw new Error('Status must be active or paused')
    }
    out.status = (value.status as LinkStatus | undefined) ?? 'active'
  }
  const startsAt = validateDate(value.startsAt, 'Start time')
  if (!partial || startsAt !== undefined) out.startsAt = startsAt
  const expiresAt = validateDate(value.expiresAt, 'Expiry')
  if (!partial || expiresAt !== undefined) out.expiresAt = expiresAt
  const expiredRedirectUrl = validateOptionalUrl(value.expiredRedirectUrl)
  if (!partial || expiredRedirectUrl !== undefined) out.expiredRedirectUrl = expiredRedirectUrl
  const maxClicks = validateMaxClicks(value.maxClicks)
  if (!partial || maxClicks !== undefined) out.maxClicks = maxClicks
  if (!partial || value.privacyEnabled !== undefined) {
    if (value.privacyEnabled !== undefined && typeof value.privacyEnabled !== 'boolean') {
      throw new Error('Privacy mode must be a boolean')
    }
    out.privacyEnabled = value.privacyEnabled === true
  }
  const password = validatePassword(value.password)
  if (!partial || password !== undefined) out.password = password
  if (out.startsAt && out.expiresAt && new Date(out.startsAt) >= new Date(out.expiresAt)) {
    throw new Error('Expiry must be after the scheduled start')
  }
  return out as LinkInput
}

export function safeLink(row: Link): SafeLink {
  const { passwordHash, ...rest } = row
  return { ...rest, passwordProtected: Boolean(passwordHash) }
}

export function getLinkAvailability(
  link: Pick<Link, 'status' | 'startsAt' | 'expiresAt' | 'expiredRedirectUrl' | 'maxClicks' | 'clickCount'>,
  now = new Date(),
): LinkAvailability {
  const fallbackUrl = link.expiredRedirectUrl
  const expiresAt = link.expiresAt ? new Date(link.expiresAt) : null
  const startsAt = link.startsAt ? new Date(link.startsAt) : null
  if (expiresAt && expiresAt <= now) return { state: 'expired', fallbackUrl }
  if (link.maxClicks !== null && link.clickCount >= link.maxClicks) {
    return { state: 'limit-reached', fallbackUrl }
  }
  if (link.status === 'paused') return { state: 'paused', fallbackUrl }
  if (startsAt && startsAt > now) return { state: 'scheduled', fallbackUrl }
  return { state: 'active' }
}

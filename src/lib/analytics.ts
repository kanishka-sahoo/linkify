import { UAParser } from 'ua-parser-js'
import { isbot } from 'isbot'
import { createHmac } from 'node:crypto'

export interface ClickMeta {
  ip: string | null
  country: string | null
  city: string | null
  userAgent: string | null
  browser: string | null
  os: string | null
  deviceType: string | null
  isBot: boolean
  referrer: string | null
  visitorHash: string | null
}

/** Vercel percent-encodes geo headers (`New%20York`); fall back to the raw value if it is malformed. */
function decodeHeader(value: string | null): string | null {
  if (value === null) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Extract analytics metadata from a request. Geo data comes from Vercel's
 * injected headers (x-vercel-ip-country / x-vercel-ip-city); locally they are
 * absent and the fields stay null.
 */
export function extractClickMeta(request: Request, options: { privacyEnabled?: boolean } = {}): ClickMeta {
  const h = request.headers
  const ua = h.get('user-agent')
  const ip = h.get(process.env.TRUSTED_IP_HEADER ?? 'x-real-ip')?.slice(0, 64) ?? null

  let browser: string | null = null
  let os: string | null = null
  let deviceType: string | null = null
  if (ua) {
    const parsed = UAParser(ua)
    browser = parsed.browser.name ?? null
    os = parsed.os.name ?? null
    deviceType = parsed.device.type ?? 'desktop'
  }

  const refHeader = h.get('referer')
  let referrer: string | null = null
  if (refHeader) {
    try {
      referrer = new URL(refHeader).hostname.slice(0, 255)
    } catch {
      referrer = refHeader.slice(0, 255)
    }
  }

  const hashSecret = process.env.ANALYTICS_HASH_SECRET || process.env.BETTER_AUTH_SECRET
  const visitorHash = hashSecret && (ip || ua)
    ? createHmac('sha256', hashSecret).update(`${ip ?? ''}\0${ua ?? ''}`).digest('hex')
    : null

  return {
    ip: options.privacyEnabled ? null : ip,
    country: h.get('x-vercel-ip-country')?.slice(0, 8) ?? null,
    city: options.privacyEnabled ? null : decodeHeader(h.get('x-vercel-ip-city'))?.slice(0, 128) ?? null,
    userAgent: options.privacyEnabled ? null : ua?.slice(0, 512) ?? null,
    browser: browser?.slice(0, 100) ?? null,
    os: os?.slice(0, 100) ?? null,
    deviceType: deviceType?.slice(0, 50) ?? null,
    isBot: isbot(ua),
    referrer,
    visitorHash,
  }
}

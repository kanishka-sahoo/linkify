/** Display labels for analytics values. Pure, so both server and browser can use them. */

/** Flag emoji for an ISO 3166-1 alpha-2 code, built from regional indicator symbols. */
export function countryFlag(code: string) {
  if (!/^[A-Za-z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

/**
 * Country name with its flag ("🇩🇪 Germany"); unknown codes fall back to the
 * code itself. English by default so server and browser render the same text.
 */
export function countryLabel(code: string | null, locale = 'en') {
  if (!code) return 'Unknown'
  let name = code
  try {
    name = new Intl.DisplayNames(locale, { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    // Not a valid region code (e.g. Vercel's placeholder values); show it raw.
  }
  const flag = countryFlag(code)
  return flag ? `${flag} ${name}` : name
}

/** Clicks without a Referer header came from typed URLs, apps, or privacy settings. */
export function referrerLabel(referrer: string | null) {
  return referrer ?? 'Direct'
}

/** Share of `total` as a whole percentage, with "<1%" for small non-zero shares. */
export function percentLabel(count: number, total: number) {
  if (total <= 0 || count <= 0) return '0%'
  const pct = (count / total) * 100
  return pct < 1 ? '<1%' : `${Math.round(pct)}%`
}

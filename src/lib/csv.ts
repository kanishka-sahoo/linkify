import type { LinkInput } from './link-domain'

/** One CSV cell, quoted as needed and defused against spreadsheet formula injection. */
export function csvCell(value: string | number | boolean | null | undefined) {
  let s = value == null ? '' : String(value)
  // Spreadsheet applications treat these prefixes as formulas even in a
  // correctly quoted CSV cell.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function parseRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') field += char
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field')
  row.push(field)
  if (row.some((cell) => cell.trim())) rows.push(row)
  return rows
}

function normalizedHeader(value: string) {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function optional(value: string | undefined) {
  return value?.trim() || undefined
}

export function parseLinkCsv(text: string): LinkInput[] {
  if (text.length > 2_000_000) throw new Error('CSV must be 2 MB or smaller')
  const parsed = parseRows(text)
  if (parsed.length < 2) throw new Error('CSV must include a header and at least one link')
  const headers = parsed[0].map(normalizedHeader)
  const urlIndex = headers.findIndex((header) => header === 'url' || header === 'destination')
  if (urlIndex < 0) throw new Error('CSV needs a url or destination column')

  return parsed.slice(1).map((cells) => {
    const value = (name: string) => cells[headers.indexOf(name)]
    const url = cells[urlIndex]?.trim()
    if (!url) throw new Error(`Row ${parsed.indexOf(cells) + 1} has no destination URL`)
    const maxClicks = optional(value('max_clicks'))
    const privacy = optional(value('privacy_enabled'))?.toLowerCase()
    const status = optional(value('status'))
    return {
      url,
      code: optional(value('code')),
      title: optional(value('title')),
      tags: (optional(value('tags')) ?? '').split(/[\s,;|]+/).filter(Boolean),
      status: status === 'paused' ? 'paused' : 'active',
      startsAt: optional(value('starts_at')) ?? null,
      expiresAt: optional(value('expires_at')) ?? null,
      expiredRedirectUrl: optional(value('expired_redirect_url')) ?? null,
      maxClicks: maxClicks ? Number(maxClicks) : null,
      privacyEnabled: privacy === 'true' || privacy === 'yes' || privacy === '1',
      password: optional(value('password')),
    }
  })
}

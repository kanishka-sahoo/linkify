export const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const
export type UtmField = (typeof UTM_FIELDS)[number]
export type CampaignParams = Record<UtmField, string>

export const EMPTY_CAMPAIGN: CampaignParams = {
  utm_source: '',
  utm_medium: '',
  utm_campaign: '',
  utm_term: '',
  utm_content: '',
}

export function readCampaignParams(value: string): CampaignParams {
  try {
    const url = new URL(value)
    return Object.fromEntries(UTM_FIELDS.map((field) => [field, url.searchParams.get(field) ?? ''])) as CampaignParams
  } catch {
    return { ...EMPTY_CAMPAIGN }
  }
}

export function applyCampaignParams(value: string, campaign: CampaignParams) {
  const url = new URL(value)
  for (const field of UTM_FIELDS) {
    const next = campaign[field].trim()
    if (next) url.searchParams.set(field, next)
    else url.searchParams.delete(field)
  }
  return url.toString()
}

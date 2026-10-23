export const API_SCOPES = ['links:read', 'links:write', 'stats:read'] as const
export type ApiScope = (typeof API_SCOPES)[number]

/** What each scope lets a credential do, in the words the consent screen uses. */
export const API_SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  'links:read': 'View your links',
  'links:write': 'Create, edit, pause, and delete your links',
  'stats:read': 'View click analytics',
}

export const API_SCOPES = ['links:read', 'links:write', 'stats:read'] as const
export type ApiScope = (typeof API_SCOPES)[number]

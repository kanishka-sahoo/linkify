export interface AccountState {
  role: string
  twoFactorEnabled?: boolean | null
  mustChangePassword?: boolean | null
  deactivatedAt?: Date | null
}

/**
 * Why an authenticated account may not use the app yet, or null when it may.
 * Browser sessions and API keys both go through this, so a credential can't
 * skip deactivation or the password-change or admin-TOTP requirement.
 */
export function accountRestriction(account: AccountState): string | null {
  if (account.deactivatedAt) return 'This account has been deactivated'
  if (account.mustChangePassword) return 'Change your temporary password first'
  if (account.role === 'admin' && !account.twoFactorEnabled) return 'Enable two-factor authentication first'
  return null
}

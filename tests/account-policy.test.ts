import assert from 'node:assert/strict'
import test from 'node:test'
import { accountRestriction } from '../src/lib/account-policy.ts'

test('regular users and enrolled admins are unrestricted', () => {
  assert.equal(accountRestriction({ role: 'user', twoFactorEnabled: false }), null)
  assert.equal(accountRestriction({ role: 'user', twoFactorEnabled: null }), null)
  assert.equal(accountRestriction({ role: 'admin', twoFactorEnabled: true }), null)
})

test('admins without TOTP are restricted', () => {
  assert.match(accountRestriction({ role: 'admin', twoFactorEnabled: false })!, /two-factor/)
  assert.match(accountRestriction({ role: 'admin', twoFactorEnabled: null })!, /two-factor/)
})

test('a pending password change takes precedence', () => {
  assert.match(accountRestriction({ role: 'user', mustChangePassword: true })!, /temporary password/)
  assert.match(accountRestriction({ role: 'admin', twoFactorEnabled: false, mustChangePassword: true })!, /temporary password/)
})

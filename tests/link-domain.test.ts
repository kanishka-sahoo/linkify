import assert from 'node:assert/strict'
import test from 'node:test'
import { getLinkAvailability, parseLinkInput } from '../src/lib/link-domain.ts'

const activeLink = {
  status: 'active',
  startsAt: null,
  expiresAt: null,
  expiredRedirectUrl: null,
  maxClicks: null,
  clickCount: 0,
} as const

test('lifecycle states are derived consistently', () => {
  const now = new Date('2026-08-28T12:00:00Z')
  assert.equal(getLinkAvailability(activeLink, now).state, 'active')
  assert.equal(getLinkAvailability({ ...activeLink, status: 'paused' }, now).state, 'paused')
  assert.equal(getLinkAvailability({ ...activeLink, startsAt: new Date('2026-08-29T00:00:00Z') }, now).state, 'scheduled')
  assert.equal(getLinkAvailability({ ...activeLink, expiresAt: new Date('2026-08-28T00:00:00Z') }, now).state, 'expired')
  assert.equal(getLinkAvailability({ ...activeLink, maxClicks: 10, clickCount: 10 }, now).state, 'limit-reached')
})

test('link input validates lifecycle and privacy fields', () => {
  const value = parseLinkInput({
    url: 'https://example.com',
    status: 'paused',
    startsAt: '2026-08-28T12:00:00Z',
    expiresAt: '2026-08-29T12:00:00Z',
    maxClicks: 50,
    privacyEnabled: true,
  })
  assert.equal(value.url, 'https://example.com/')
  assert.equal(value.status, 'paused')
  assert.equal(value.maxClicks, 50)
  assert.equal(value.privacyEnabled, true)
  assert.throws(() => parseLinkInput({
    url: 'https://example.com',
    startsAt: '2026-08-30T12:00:00Z',
    expiresAt: '2026-08-29T12:00:00Z',
  }), /Expiry must be after/)
})

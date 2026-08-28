import assert from 'node:assert/strict'
import test from 'node:test'
import { extractClickMeta } from '../src/lib/analytics.ts'

const meta = (headers: Record<string, string>) =>
  extractClickMeta(new Request('https://linkify.test/go', { headers }))

test('city names from Vercel geo headers are decoded', () => {
  assert.equal(meta({ 'x-vercel-ip-city': 'New%20York' }).city, 'New York')
  assert.equal(meta({ 'x-vercel-ip-city': 'S%C3%A3o%20Paulo' }).city, 'São Paulo')
})

test('malformed percent-encoding falls back to the raw header', () => {
  assert.equal(meta({ 'x-vercel-ip-city': 'Bad%E0%A4' }).city, 'Bad%E0%A4')
})

test('city is omitted when absent or privacy mode is on', () => {
  assert.equal(meta({}).city, null)
  const request = new Request('https://linkify.test/go', { headers: { 'x-vercel-ip-city': 'New%20York' } })
  assert.equal(extractClickMeta(request, { privacyEnabled: true }).city, null)
})

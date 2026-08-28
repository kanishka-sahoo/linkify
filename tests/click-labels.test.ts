import assert from 'node:assert/strict'
import test from 'node:test'
import { countryFlag, countryLabel, percentLabel, referrerLabel } from '../src/lib/click-labels.ts'

test('countries show a flag and English name', () => {
  assert.equal(countryFlag('de'), '🇩🇪')
  assert.equal(countryLabel('DE'), '🇩🇪 Germany')
  assert.equal(countryLabel('US'), '🇺🇸 United States')
})

test('missing or invalid country codes degrade gracefully', () => {
  assert.equal(countryLabel(null), 'Unknown')
  assert.equal(countryFlag('XYZ'), '')
  assert.equal(countryLabel('XYZ'), 'XYZ')
})

test('null referrers read as Direct', () => {
  assert.equal(referrerLabel(null), 'Direct')
  assert.equal(referrerLabel('news.example'), 'news.example')
})

test('percentages round and flag tiny shares', () => {
  assert.equal(percentLabel(1, 3), '33%')
  assert.equal(percentLabel(1, 500), '<1%')
  assert.equal(percentLabel(0, 10), '0%')
  assert.equal(percentLabel(5, 0), '0%')
})

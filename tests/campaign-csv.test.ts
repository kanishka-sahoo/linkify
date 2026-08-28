import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCampaignParams, readCampaignParams } from '../src/lib/campaign.ts'
import { parseLinkCsv } from '../src/lib/csv.ts'

test('campaign parameters are composed without losing existing query values', () => {
  const url = applyCampaignParams('https://example.com/page?ref=docs&utm_source=old', {
    utm_source: 'newsletter',
    utm_medium: 'email',
    utm_campaign: 'launch',
    utm_term: '',
    utm_content: '',
  })
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get('ref'), 'docs')
  assert.deepEqual(readCampaignParams(url), {
    utm_source: 'newsletter',
    utm_medium: 'email',
    utm_campaign: 'launch',
    utm_term: '',
    utm_content: '',
  })
})

test('CSV parser handles quoted destinations and lifecycle fields', () => {
  const [row] = parseLinkCsv([
    'code,destination,title,tags,status,max_clicks,privacy_enabled',
    'launch,"https://example.com/page?a=1,b=2","Launch, phase 1","email q3",paused,100,yes',
  ].join('\n'))
  assert.equal(row.code, 'launch')
  assert.equal(row.url, 'https://example.com/page?a=1,b=2')
  assert.equal(row.title, 'Launch, phase 1')
  assert.deepEqual(row.tags, ['email', 'q3'])
  assert.equal(row.status, 'paused')
  assert.equal(row.maxClicks, 100)
  assert.equal(row.privacyEnabled, true)
})

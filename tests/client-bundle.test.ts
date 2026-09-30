import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

const ASSETS = '.output/public/assets'

// Server-only crypto from src/lib/keys.ts. If it reaches the browser, the page
// throws "Buffer is not defined" on load and never hydrates, so sign-in breaks.
const SERVER_ONLY = /\b(randomBytes|scryptSync|timingSafeEqual|createHash)\b/

test('client bundles contain no server-only code', { skip: !existsSync(ASSETS) && 'no build; run `npm run build`' }, () => {
  const leaks = readdirSync(ASSETS)
    .filter((file) => file.endsWith('.js'))
    .filter((file) => SERVER_ONLY.test(readFileSync(`${ASSETS}/${file}`, 'utf8')))
  assert.deepEqual(leaks, [])
})

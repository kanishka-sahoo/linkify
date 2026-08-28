#!/usr/bin/env node
/** Apply committed migrations explicitly. Never mutates a database during a
 * normal application build and never attempts an implicit schema push. */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Fall back to .env when DATABASE_URL isn't in the environment (local runs).
if (!process.env.DATABASE_URL && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']\s*$/g, '')
  }
}
if (!process.env.DATABASE_URL) {
  console.error('[migrate] DATABASE_URL is not set')
  process.exit(1)
}

try {
  execFileSync(path.join('node_modules', '.bin', 'drizzle-kit'), ['migrate'], { stdio: 'inherit' })
  console.log('[migrate] database is up to date')
} catch {
  process.exit(1)
}

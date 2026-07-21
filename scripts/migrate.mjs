#!/usr/bin/env node
/**
 * Build-time database migration, safe for every database state:
 *
 *  1. Fresh database        → apply all migrations normally.
 *  2. Migrated database     → apply only pending migrations.
 *  3. Pre-existing database (provisioned via `drizzle-kit push` before
 *     migrations were adopted, possibly schema-drifted)
 *                            → `drizzle-kit push` reconciles drift, the
 *                              baseline migration is marked as applied, then
 *                              the migrator takes over for anything newer.
 *
 * Usage: node scripts/migrate.mjs   (reads DATABASE_URL from env or .env)
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

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

const MIGRATIONS_DIR = 'drizzle'
const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'))

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })

try {
  await client.connect()

  const [{ reg }] = await client.query("select to_regclass('drizzle.__drizzle_migrations') as reg").then((r) => r.rows)
  let historyCount = 0
  if (reg) {
    const { rows } = await client.query('select count(*)::int as n from drizzle.__drizzle_migrations')
    historyCount = rows[0].n
  }
  // Note: unquoted aliases come back lowercased from Postgres — keep them snake_case.
  const { rows: [{ has_app }] } = await client.query("select to_regclass('links') is not null as has_app")

  if (historyCount === 0 && has_app) {
    console.log('[migrate] existing database without migration history — reconciling schema with drizzle-kit push')
    // Non-interactive: applies additive changes; aborts rather than destroy data.
    execFileSync(path.join('node_modules', '.bin', 'drizzle-kit'), ['push'], { stdio: 'inherit' })

    // Mark the baseline (first) migration as applied so the migrator skips it.
    // Later journal entries, if any, are genuinely new and will run below.
    const first = journal.entries[0]
    const sqlText = fs.readFileSync(path.join(MIGRATIONS_DIR, `${first.tag}.sql`), 'utf8')
    const hash = createHash('sha256').update(sqlText).digest('hex')
    await client.query('create schema if not exists drizzle')
    await client.query(
      'create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)',
    )
    await client.query('insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)', [hash, first.when])
    console.log(`[migrate] baselined migration "${first.tag}"`)
  }
} catch (err) {
  console.error('[migrate] failed while preparing database:', err)
  process.exit(1)
} finally {
  await client.end().catch(() => {})
}

// Hand off to drizzle-kit for the actual migration run (keeps CLI output and
// honors drizzle.config.ts, including .env loading).
try {
  execFileSync(path.join('node_modules', '.bin', 'drizzle-kit'), ['migrate'], { stdio: 'inherit' })
  console.log('[migrate] database is up to date')
} catch {
  process.exit(1)
}

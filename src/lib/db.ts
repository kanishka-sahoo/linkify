import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

const url = process.env.DATABASE_URL!

// Local development can point DATABASE_URL at any plain Postgres (e.g. docker);
// production uses Neon's serverless HTTP driver.
const isLocal = /localhost|127\.0\.0\.1/.test(url)

export const db: NodePgDatabase<typeof schema> = isLocal
  ? drizzlePg(url, { schema })
  : (drizzleNeon(neon(url), { schema }) as unknown as NodePgDatabase<typeof schema>)

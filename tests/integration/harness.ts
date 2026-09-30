/**
 * Integration test harness: runs the production build (.output/) against a
 * real Postgres database and talks to it over HTTP, so tests exercise the
 * same code paths as a deployment.
 *
 * Requires `npm run build` first and TEST_DATABASE_URL pointing at a
 * disposable database whose name ends in `_test`. Every test file truncates
 * all tables, so never point this at data you care about.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import pg from 'pg'
import { hashPassword } from 'better-auth/crypto'
import { toJSONAsync } from 'seroval'

export const DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''

/** Reason to skip, or false when the environment can run integration tests. */
export const skip: string | false = !DATABASE_URL
  ? 'TEST_DATABASE_URL is not set'
  : !existsSync('.output/server/index.mjs')
    ? 'no build found; run `npm run build` first'
    : false

// A silently skipped suite in CI would hide the security regression tests.
if (skip && process.env.CI) throw new Error(`Integration tests cannot run in CI: ${skip}`)

if (DATABASE_URL && !new URL(DATABASE_URL).pathname.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must name a database ending in "_test"; its tables are truncated')
}

export const pool = new pg.Pool({ connectionString: DATABASE_URL || undefined, max: 4 })

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  return (await pool.query<T>(text, params)).rows
}

export function migrate() {
  execFileSync('node_modules/.bin/drizzle-kit', ['migrate'], {
    env: { ...process.env, DATABASE_URL },
    stdio: 'pipe',
  })
}

export async function resetDb() {
  await query(`truncate table
    "user", session, account, verification, two_factor, passkey,
    links, clicks, api_keys, rate_limits, auth_rate_limit, audit_logs
    restart identity cascade`)
}

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => resolve(port))
    })
  })
}

export interface App {
  baseUrl: string
  cronSecret: string
  authSecret: string
  stop: () => Promise<void>
}

/** Start the built server on a free port and wait until it answers. */
export async function startApp(): Promise<App> {
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const secret = () => randomBytes(32).toString('base64')
  const cronSecret = secret()
  const authSecret = secret()
  let output = ''
  const child: ChildProcess = spawn(process.execPath, ['.output/server/index.mjs'], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      PORT: String(port),
      HOST: '127.0.0.1',
      DATABASE_URL,
      BETTER_AUTH_SECRET: authSecret,
      BETTER_AUTH_URL: baseUrl,
      APP_BASE_URL: baseUrl,
      SETUP_SECRET: secret(),
      CRON_SECRET: cronSecret,
      TRUSTED_IP_HEADER: 'x-real-ip',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout!.on('data', (d) => { output += d })
  child.stderr!.on('data', (d) => { output += d })

  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${output}`)
    try {
      await fetch(`${baseUrl}/api/v1/links`)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  if (Date.now() >= deadline) {
    child.kill()
    throw new Error(`server did not start within 20s:\n${output}`)
  }

  return {
    baseUrl,
    cronSecret,
    authSecret,
    // SIGKILL: a graceful shutdown waits ~10s on the client's keep-alive
    // sockets, and this server has nothing to flush.
    stop: () => new Promise((resolve) => {
      child.once('exit', () => resolve())
      child.kill('SIGKILL')
    }),
  }
}

// ---------- fixtures ----------

let seq = 0
const id = () => `${Date.now().toString(36)}${(seq++).toString(36)}${randomBytes(4).toString('hex')}`

export interface UserOptions {
  role?: 'admin' | 'user'
  twoFactorEnabled?: boolean
  mustChangePassword?: boolean
}

export async function createUser(opts: UserOptions = {}) {
  const userId = id()
  await query(
    `insert into "user" (id, name, email, role, two_factor_enabled, must_change_password)
     values ($1, $2, $3, $4, $5, $6)`,
    [userId, `User ${userId}`, `${userId}@test.local`, opts.role ?? 'user', opts.twoFactorEnabled ?? false, opts.mustChangePassword ?? false],
  )
  return userId
}

export async function createApiKey(
  userId: string,
  opts: { scopes?: string[]; expiresAt?: Date } = {},
) {
  const key = `lk_${randomBytes(24).toString('hex')}`
  await query(
    `insert into api_keys (id, name, key_hash, key_prefix, scopes, expires_at, user_id)
     values ($1, 'test', $2, $3, $4, $5, $6)`,
    [
      id(),
      createHash('sha256').update(key).digest('hex'),
      key.slice(0, 10),
      opts.scopes ?? ['links:read', 'links:write', 'stats:read'],
      opts.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      userId,
    ],
  )
  return key
}

/** Insert a session for `userId` and return a signed Cookie header, as better-auth sets it after sign-in. */
export async function sessionCookie(app: App, userId: string) {
  const token = randomBytes(24).toString('hex')
  await query(
    `insert into session (id, token, user_id, expires_at) values ($1, $2, $3, $4)`,
    [id(), token, userId, new Date(Date.now() + 60 * 60 * 1000)],
  )
  const signature = createHmac('sha256', app.authSecret).update(token).digest('base64')
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`
}

/** Give `userId` an email/password credential, as sign-up or admin user creation does. */
export async function setPassword(userId: string, password: string) {
  await query(
    `insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
     values ($1, $2, 'credential', $2, $3, now(), now())`,
    [id(), userId, await hashPassword(password)],
  )
}

/** Sign in over HTTP and return the Cookie header the browser would send next. */
export async function signIn(app: App, email: string, password: string) {
  const res = await fetch(`${app.baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: app.baseUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`)
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}

/** The build-time RPC id of a server function, read from the build output. */
function serverFnId(name: string) {
  const dir = '.output/server/_ssr'
  for (const file of readdirSync(dir)) {
    const match = readFileSync(`${dir}/${file}`, 'utf8').match(
      new RegExp(`id: "([0-9a-f]+)",\\s*name: "${name}"`),
    )
    if (match) return match[1]
  }
  throw new Error(`server function ${name} not found in build`)
}

/** Call a server function the way the browser does. */
export async function callServerFn(app: App, name: string, data: unknown, cookie: string) {
  const res = await fetch(`${app.baseUrl}/_serverFn/${serverFnId(name)}`, {
    method: 'POST',
    headers: { origin: app.baseUrl, 'content-type': 'application/json', 'x-tsr-serverFn': 'true', cookie },
    body: JSON.stringify(await toJSONAsync({ data })),
  })
  return { status: res.status, setCookie: res.headers.getSetCookie(), body: await res.text() }
}

/** Minimal REST client bound to one API key. */
export function client(app: App, key: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${app.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
  return {
    list: () => call('GET', '/api/v1/links'),
    get: (linkId: string) => call('GET', `/api/v1/links/${linkId}`),
    create: (input: Record<string, unknown>) => call('POST', '/api/v1/links', input),
    update: (linkId: string, input: Record<string, unknown>) => call('PATCH', `/api/v1/links/${linkId}`, input),
    remove: (linkId: string) => call('DELETE', `/api/v1/links/${linkId}`),
    stats: (linkId: string, days = 30) => call('GET', `/api/v1/links/${linkId}/stats?days=${days}`),
  }
}

/** Distinct documentation-range IPs so per-IP visit limits don't interfere. */
export const ip = (n: number) => `198.51.100.${(n % 250) + 1}`

/** Minimal MCP client bound to one API key: raw POSTs plus a `tools/call` shortcut. */
export function mcpClient(app: App, key: string) {
  let nextId = 1
  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${app.baseUrl}/api/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
  }
  const request = (method: string, params?: unknown) => post({ jsonrpc: '2.0', id: nextId++, method, params })
  /** Calls a tool and returns its structured result, or `{ isError, message }` for tool errors. */
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await request('tools/call', { name, arguments: args })
    if (res.status !== 200 || res.body.error) throw new Error(`tools/call ${name}: ${res.status} ${JSON.stringify(res.body)}`)
    const result = res.body.result
    return result.isError
      ? { isError: true as const, message: result.content[0].text as string }
      : { isError: false as const, ...result.structuredContent }
  }
  return { post, request, call }
}

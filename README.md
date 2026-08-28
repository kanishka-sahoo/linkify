# Linkify

[![CI](https://github.com/kanishka-sahoo/linkify/actions/workflows/ci.yml/badge.svg)](https://github.com/kanishka-sahoo/linkify/actions/workflows/ci.yml)

A single-user / small-team link shortener with analytics, built on TanStack Start, shadcn/ui, Neon Postgres and Vercel.

## Features

- **Short links** — random or custom codes, optional titles
- **Tags** — up to 10 per link, with filter chips and tag search on the dashboard
- **Teams & ownership** — role-based access (admin/user); non-admin users see and manage only their own links and stats, admins see everything with an owner column
- **Lifecycle controls** — pause links, schedule activation, expire them, cap clicks, and optionally redirect inactive traffic to a fallback URL
- **Password protection** — visitors must enter a password before being redirected; brute-force attempts are rate-limited (5 failures per link+IP locks for 15 min)
- **Campaigns** — duplicate links, compose UTM parameters, and save campaign presets in the browser
- **Analytics** — total and unique-human clicks, country/city (via Vercel geo headers), browser/OS/device, referrer, and bot detection; per-link privacy mode omits raw IP, city, and user agent
- **Dashboards** — clicks-over-time chart, country/referrer/browser/OS/device breakdowns, bot ratio, raw click log; text search, lifecycle filters, CSV import/export, and bulk lifecycle/tag/ownership editing
- **QR codes** — authenticated, owner-scoped per-link PNG generation (`/api/qr/:code`)
- **Auth** — email + password, TOTP two-factor, passkeys, database-backed throttling, session management, and security activity. First-run registration requires the deployment's setup secret; administrators must enable TOTP before managing data or users
- **REST API** — expiring bearer keys with explicit read/write/stats scopes; keys are per-user and owner-scoped (admin keys see all); link creation is capped at 30/hour per user

## Stack

| Layer    | Choice |
|----------|--------|
| App      | TanStack Start (React 19, Vite) |
| UI       | shadcn/ui + Tailwind CSS v4, recharts |
| Database | Neon Postgres + Drizzle ORM |
| Auth     | better-auth (twoFactor + passkey plugins) |
| Hosting  | Vercel |

## Setup

1. **Install**

   ```bash
   npm install
   ```

2. **Configure environment** — copy `.env.example` to `.env` and fill in:

   - `DATABASE_URL` — Neon Postgres connection string
   - `BETTER_AUTH_SECRET` — long random string
   - `BETTER_AUTH_URL` — app URL (`http://localhost:3000` locally)
   - `SETUP_SECRET` — a separate random value of at least 32 characters, required to create the first account
   - `CRON_SECRET` — a separate random value of at least 32 characters, used by the retention job
   - `APP_BASE_URL` — public base used to build short URLs and QR codes
   - `ANALYTICS_HASH_SECRET` — optional dedicated HMAC secret for pseudonymous unique-visitor counting; falls back to `BETTER_AUTH_SECRET`

3. **Create the tables**

   ```bash
   npm run db:migrate
   ```

   Migrations live in `drizzle/` and are committed to the repo. To change the schema: edit `src/lib/schema.ts`, run `npm run db:generate` to emit a migration, apply it locally with `npm run db:migrate`, and commit both files. (`npm run db:push` is still available for quick throwaway-dev-DB iteration, but anything meant for production should go through a generated migration.)

4. **Run**

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000` — you'll be sent to `/setup`; enter `SETUP_SECRET` to create the owner account. Afterwards, registration is permanently closed (enforced atomically in the database). The owner must set up TOTP in **Settings** before managing links or users. Accounts created by an administrator must replace their temporary password at first sign-in.

## Testing

```bash
npm test                 # unit tests (no database needed)
npm run build            # integration tests run against the production build
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/linkify_test npm run test:integration
```

Integration tests (`tests/integration/`) start the built server on a free port, run migrations against `TEST_DATABASE_URL`, and exercise it over HTTP: API-key auth and scopes, link ownership, click caps and password lockouts under concurrent requests, and privacy mode. **Every table in that database is truncated**, so the harness refuses to run unless the database name ends in `_test`. Without `TEST_DATABASE_URL` the suite is skipped locally; in CI it fails instead. A throwaway database:

```bash
docker run -d --name linkify-test-pg -e POSTGRES_USER=linkify -e POSTGRES_PASSWORD=linkify \
  -e POSTGRES_DB=linkify_test -p 5432:5432 postgres:17-alpine
```

CI runs the build, typecheck, unit tests, and integration tests on every pull request. Merging to `main` requires them to pass.

## Deploying to Vercel

1. Push the repo and import it in Vercel (framework auto-detected).
2. Set every variable in `.env.example` in the project settings (`APP_BASE_URL` and `BETTER_AUTH_URL` = your production origin). Keep `SETUP_SECRET`, `BETTER_AUTH_SECRET`, and `CRON_SECRET` distinct.
3. Apply migrations to the intended production database with `npm run db:migrate` from a controlled release job or operator shell.
4. Deploy. Click analytics geo fields (`country`, `city`, `ip`) populate automatically from Vercel's request headers.

Normal builds never mutate the database, so preview deployments cannot accidentally migrate production. `npm run db:migrate` applies committed migrations only; it never falls back to `drizzle-kit push`. For a tightly controlled deployment environment, `npm run build:with-migrations` is available explicitly. A pre-existing database created with `db:push` must be baselined manually before adopting committed migrations.

`vercel.json` applies browser security headers and schedules `/api/internal/cleanup` daily. Vercel authenticates the job with `CRON_SECRET`; it rolls up the previous day's clicks into the `click_daily` table that analytics read from, then removes expired API keys and rate-limit rows, analytics older than `ANALYTICS_RETENTION_DAYS`, and security events older than `AUDIT_RETENTION_DAYS`.

## API

Authenticate with `Authorization: Bearer <key>` (create a scoped, expiring key in **Settings → API keys**). JSON requests must use `Content-Type: application/json`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/links` | List links |
| `POST` | `/api/v1/links` | Create link `{ url, code?, title?, tags?, status?, startsAt?, expiresAt?, expiredRedirectUrl?, maxClicks?, privacyEnabled?, password? }` |
| `GET` | `/api/v1/links/:id` | Get one link |
| `PATCH` | `/api/v1/links/:id` | Update fields (pass `password: null` to remove protection) |
| `DELETE` | `/api/v1/links/:id` | Delete link and its clicks |
| `GET` | `/api/v1/links/:id/stats?days=30` | Aggregated stats (series, countries, referrers, bot split) |

Example:

```bash
curl -X POST https://your-domain/api/v1/links \
  -H "Authorization: Bearer lk_..." \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "code": "launch", "expiresAt": "2026-08-01T00:00:00Z"}'
```

## Notes

- Redirects issue `302` with `cache-control: no-store` so every hit is counted.
- Click capture failures never block a redirect — they're logged and swallowed.
- Reserved codes: `dashboard`, `login`, `setup`, `api`.
- Rate limits live in Postgres, so they hold across serverless instances: sign-in and 2FA endpoints, API keys, public visits, password guesses, and link creation are all throttled.
- Browser responses include CSP, clickjacking, MIME-sniffing, referrer, permissions, opener, and HSTS protections. TOTP QR codes are generated locally and the secret is never sent to a third-party image service.
- CSV exports neutralize spreadsheet formula prefixes. API and dashboard responses expose only `passwordProtected`, never stored password hashes.

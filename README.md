# Linkify

A single-user / small-team link shortener with analytics, built on TanStack Start, shadcn/ui, Neon Postgres and Vercel.

## Features

- **Short links** — random or custom codes, optional titles
- **Tags** — up to 10 per link, with filter chips and tag search on the dashboard
- **Teams & ownership** — role-based access (admin/user); non-admin users see and manage only their own links and stats, admins see everything with an owner column
- **Expiry** — links return 410 after a configurable date/time
- **Password protection** — visitors must enter a password before being redirected; brute-force attempts are rate-limited (5 failures per link+IP locks for 15 min)
- **Analytics** — every click records IP, country/city (via Vercel geo headers), user agent, browser/OS/device, referrer, and bot vs human detection
- **Dashboards** — clicks-over-time chart, country/referrer/browser/OS/device breakdowns, bot ratio, raw click log; text search across code/URL/title/tags/owner plus status filters, bulk delete/expire/CSV-export
- **QR codes** — per-link PNG generation (`/api/qr/:code`)
- **Auth** — email + password, TOTP two-factor, and passkeys. The first registered account becomes the admin; afterwards only admins can create accounts (Settings → Users)
- **REST API** — manage links and read stats with bearer API keys; keys are per-user and scoped to that user's links (admin keys see all); link creation is capped at 30/hour per user

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
   - `APP_BASE_URL` — public base used to build short URLs and QR codes

3. **Create the tables**

   ```bash
   npm run db:migrate
   ```

   Migrations live in `drizzle/` and are committed to the repo. To change the schema: edit `src/lib/schema.ts`, run `npm run db:generate` to emit a migration, apply it locally with `npm run db:migrate`, and commit both files. (`npm run db:push` is still available for quick throwaway-dev-DB iteration, but anything meant for production should go through a generated migration.)

4. **Run**

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000` — you'll be sent to `/setup` to create the owner account. Afterwards, registration is permanently closed (enforced server-side). Set up TOTP 2FA and a passkey in **Settings**.

## Deploying to Vercel

1. Push the repo and import it in Vercel (framework auto-detected).
2. Set the env vars above in the project settings (`APP_BASE_URL` = your production domain).
3. Deploy. Click analytics geo fields (`country`, `city`, `ip`) populate automatically from Vercel's request headers.

**Schema migrations run automatically**: the build command is `node scripts/migrate.mjs && vite build`, so every deploy first brings `DATABASE_URL`'s database up to date with the committed migrations in `drizzle/`. The script handles three states: fresh databases get all migrations, previously migrated databases get only pending ones, and pre-existing databases provisioned via `db:push` (possibly schema-drifted) are reconciled with `drizzle-kit push` and baselined before the migrator takes over. `DATABASE_URL` must be available at build time (Vercel exposes project env vars to builds by default). Note that preview deployments also run migrations against whatever `DATABASE_URL` they see — use the Neon Vercel integration's per-preview branches, or only merge schema changes when you're ready for them to hit the production database.

## API

Authenticate with `Authorization: Bearer <key>` (create keys in **Settings → API keys**).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/links` | List links |
| `POST` | `/api/v1/links` | Create link `{ url, code?, title?, tags?, expiresAt?, password? }` |
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
- Rate limits live in the `rate_limits` table (fixed windows), so they hold across serverless instances: password guesses are capped at 5 per 15 min per link+IP, and link creation at 30/hour per user (dashboard and API alike).

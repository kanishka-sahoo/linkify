# Linkify

A single-user / small-team link shortener with analytics, built on TanStack Start, shadcn/ui, Neon Postgres and Vercel.

## Features

- **Short links** — random or custom codes, optional titles
- **Expiry** — links return 410 after a configurable date/time
- **Password protection** — visitors must enter a password before being redirected
- **Analytics** — every click records IP, country/city (via Vercel geo headers), user agent, browser/OS/device, referrer, and bot vs human detection
- **Dashboards** — clicks-over-time chart, country/referrer/browser/OS/device breakdowns, bot ratio, raw click log
- **QR codes** — per-link PNG generation (`/api/qr/:code`)
- **Auth** — email + password, TOTP two-factor, and passkeys (single-tenant: only the first registered account exists)
- **REST API** — manage links and read stats with bearer API keys

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
   npm run db:push
   ```

   (or `npm run db:generate && npm run db:migrate` for versioned migrations)

4. **Run**

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000` — you'll be sent to `/setup` to create the owner account. Afterwards, registration is permanently closed (enforced server-side). Set up TOTP 2FA and a passkey in **Settings**.

## Deploying to Vercel

1. Push the repo and import it in Vercel (framework auto-detected).
2. Set the env vars above in the project settings (`APP_BASE_URL` = your production domain).
3. Deploy. Click analytics geo fields (`country`, `city`, `ip`) populate automatically from Vercel's request headers.

## API

Authenticate with `Authorization: Bearer <key>` (create keys in **Settings → API keys**).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/links` | List links |
| `POST` | `/api/v1/links` | Create link `{ url, code?, title?, expiresAt?, password? }` |
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

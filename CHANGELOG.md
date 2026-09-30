# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

Versions 0.1.0–0.5.0 were tagged retroactively on 2026-09-27 against the
commits that shipped them; the dates below are the original commit dates.

## [Unreleased]

### Added
- MCP server at `/api/mcp` so AI agents can list, search, create, edit, pause,
  and delete links and read per-link stats, click logs, and account-wide
  analytics. It uses the existing API keys: scopes decide which tools a key
  sees and can call, ownership rules match the REST API, and writes are
  audit-logged as `mcp.link.*`. Speaks MCP 2026-07-28 (stateless requests,
  `server/discover`, mirrored headers, cache hints) and still accepts clients
  on 2024-11-05 through 2025-11-25 (#1)
- Admins can take over every link owned by another account, admin or user,
  from the Users page. Admins who leave are deactivated instead of deleted:
  they can't sign in or use API keys, and their links keep redirecting until
  another admin takes them over. Deactivated admins can be reactivated (#50)
- Link analytics show labelled bars with counts and percentages instead of
  unlabelled donuts, country flags and names, and "Direct" for referrer-less
  visits; the click log pages with "Load more", filters by humans and
  country, and exports to CSV (#19)
- Visits to inactive links are recorded with an outcome (`fallback`, `blocked`,
  or `password_failed`) and shown in a "Visit outcomes" card and the stats API;
  they don't count toward click limits or the other analytics (#36)
- GitHub Actions CI (build, typecheck, unit tests, dependency audit), required to pass before merging to `main` (#11)
- Integration tests against Postgres and the production build: API-key auth and
  scopes, ownership, concurrent click caps and password lockouts, privacy mode (#12)

### Changed
- REST link create/update/delete moved into a service shared with the MCP
  server. `PATCH /api/v1/links/:id` now returns 404 instead of 409 when
  renaming another user's link onto a taken code (#1)
- Link analytics read per-day rollups (`click_daily`) maintained by the daily
  cleanup job instead of 8 scans of raw clicks per page view; 30-day to 1-year
  ranges load 2.3–3x faster on 1M clicks. Rolled-up counts outlive
  `ANALYTICS_RETENTION_DAYS`; unique visitors still come from raw clicks (#28)
- Deleting a user moves their links and analytics to the admin who deleted
  them instead of deleting the links. Active admins must be deactivated before
  they can be deleted (#50)

### Fixed
- Changing a temporary password no longer signs the user out; the current
  session is kept, other sessions are still revoked, and the user continues to
  the dashboard (#47)
- Admins without two-factor authentication are told on the settings page that
  they must enable it, instead of being silently sent back there; after a
  forced password change they stay on settings until 2FA is set up, then
  continue to the dashboard (#47)
- Dashboard dates render in a fixed UTC form on the server and switch to the
  viewer's locale and timezone after hydration, so pages no longer fail to
  hydrate when the two differ (#1)

### Security
- API keys no longer work for admins who haven't enrolled TOTP, or for accounts
  with a pending temporary-password change, matching the browser-session rules (#7)
- Password attempts on protected links are counted atomically before
  verification; concurrent guesses could previously exceed the 5-attempt lockout (#8)

### Removed
- Unused dependencies (`@tanstack/react-query`, Radix popover/select,
  `vite-tsconfig-paths`) and dead code (#37)

## [0.5.0] - 2026-08-28

### Added
- Link lifecycle: pause, scheduled activation, expiry, click caps, and a
  fallback URL for inactive traffic
- Campaign tools: duplicate links, UTM composer, and saved campaign presets
- CSV import and export, plus bulk lifecycle/tag/ownership editing
- Per-link privacy mode that omits raw IP, city, and user agent
- Pseudonymous unique-visitor counting (HMAC visitor hash)
- First unit tests for link validation, campaign parameters, and CSV parsing

## [0.4.0] - 2026-08-28

### Security
- First-run setup requires a deployment `SETUP_SECRET`; single bootstrap owner
  enforced by a partial unique index
- Administrators must enroll TOTP before managing data or users; accounts
  created by an admin must change their temporary password
- API keys gained expiry and explicit `links:read` / `links:write` /
  `stats:read` scopes
- Database-backed throttling for sign-in, 2FA, API keys, and public visits
- Session management and a security activity (audit) log in Settings
- Browser security headers (CSP, HSTS, frame, referrer, permissions)
- QR codes are authenticated and owner-scoped; TOTP QR rendered locally
- Spreadsheet formula neutralization in CSV export

### Added
- Daily retention job (`/api/internal/cleanup`) for expired keys, rate-limit
  rows, old analytics, and audit events

### Changed
- Builds no longer run migrations; `npm run db:migrate` is explicit

## [0.3.0] - 2026-07-21

### Added
- Tags on links, with filter chips and tag search
- Link and API-key ownership: non-admins see only their own links and stats
- Postgres-backed rate limits: 5 failed password attempts per link+IP per
  15 minutes; 30 link creations per user per hour
- Committed Drizzle migrations

## [0.2.0] - 2026-07-20

### Added
- Admin/user roles with last-admin protection
- Team member management on a dedicated `/dashboard/users` page

### Fixed
- 2FA schema fields required by the better-auth twoFactor plugin

### Performance
- A single `getBootstrap()` call replaces sequential session/setup checks
- Settings data is loaded server-side in one round trip
- 30s loader stale time; Vite warmup for faster dev loads

## [0.1.0] - 2026-07-20

### Added
- Short links with random or custom codes
- Click analytics: country/city, browser, OS, device, referrer, bot detection
- Email/password auth with TOTP two-factor and passkeys
- REST API with bearer keys
- QR code generation

[Unreleased]: https://github.com/kanishka-sahoo/linkify/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/kanishka-sahoo/linkify/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kanishka-sahoo/linkify/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kanishka-sahoo/linkify/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kanishka-sahoo/linkify/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kanishka-sahoo/linkify/releases/tag/v0.1.0

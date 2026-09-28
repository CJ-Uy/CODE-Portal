# CODE Portal — Master Design & Build Plan

> **Status:** v5 — AGREED, ready to implement. v4 converged over 4 Claude⇄Codex adversarial rounds; v5 is a user-driven scope revision after a stakeholder meeting, made before any phase past Phase 0/1 (foundations, auth/RBAC, upload hardening) was built. No other implementation has begun; each Phase becomes its own task plan.
> **For agentic workers:** Each Phase below becomes its own `superpowers:writing-plans` bite-sized task plan at implementation time. This document is the architecture contract those plans must honor.
> **Revision log + review resolutions are at the end (§14, v5 entry is the most recent).**

**Goal:** Build the full Ateneo CODE web application — a public OD publishing site plus a signed-in member portal and scoped admin tools — on Cloudflare (Workers via OpenNext, D1, R2) with Drizzle as the single schema/migration source of truth across local, shared-dev, and production.

**Architecture:** Next.js 16 App Router rendered on Cloudflare Workers through `@opennextjs/cloudflare`. All infrastructure access stays behind the existing adapter seam (`src/db`, `src/storage`, `src/server`). Drizzle ORM runs server-side in the prod Worker and the dev Worker against their own D1 bindings; pure-local fallback uses better-sqlite3 through the same Drizzle schema; outside ("shared") developers run the app locally and reach the **dev Worker** through a typed, per-domain internal API, authenticated by a bearer token that maps to a seeded actor — they never receive Cloudflare credentials.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS v4 + local shadcn-style components, Drizzle ORM + drizzle-kit, Cloudflare D1 / R2 / Workers, OpenNext, Auth.js v5 (`next-auth`) + `@auth/drizzle-adapter` (Google OAuth, database sessions), Zod, Vitest + `@cloudflare/vitest-pool-workers`, shadcn/ui (local `src/components/ui` registry) + lucide-react.

---

## Global Constraints

- Public site is reader-first at `/`; member workspace lives under `/portal`; admin is a module inside the signed-in workspace, not a separate top-level brand.
- Drizzle schema at `src/db/schema.ts` is the ONE source of truth for all environments. One migration set under `drizzle/migrations`. No second hand-written migration tree.
- Only infrastructure/adapter code (`src/server/cloudflare.ts`, `src/db/adapters/*`, `src/storage/adapters/*`, internal-API route modules) may call `getCloudflareContext()` or touch raw bindings. Feature code uses repositories. System route handlers (e.g. `/l/[slug]`) may use `runInBackground()` — a thin `ctx.waitUntil` wrapper exported from `src/server/cloudflare.ts` — without otherwise touching bindings.
- Outside (shared-dev) developers must never receive production OR dev Cloudflare credentials. Shared mode talks to a typed internal API over HTTPS with a bearer token that maps to a seeded actor. No raw SQL endpoint. No generic "run any op" dispatcher. D1 is never exposed as `DATABASE_URL`.
- Two orthogonal axes (see §2): `DEPLOY_ENV` (`prod` | `dev`) identifies the deployed Worker + its bindings; `APP_ENV` (`local` | `shared` | `production`) identifies how a running process accesses data. The dev Worker runs `DEPLOY_ENV=dev` with `APP_ENV=production` (uses its own dev D1/R2 bindings) and additionally exposes the internal API.
- `STORAGE_MODE` values usable outside prod: `local`, `api`, `r2-s3`; prod is locked to `binding` unless `ALLOW_PRODUCTION_STORAGE_MODE_OVERRIDE=true`.
- Auth: Google OAuth only for v1, restricted to allowed Google Workspace domain(s) + an explicit allowlist for org Gmail accounts. First valid sign-in provisions a `members` row with the base `member` role; elevated roles are admin-assigned.
- Every mutation and every admin read is authorization-checked server-side via the SAME `permissions.can()` regardless of access mode. Every admin state change writes an audit log row.
- Mutating `/api/*` handlers (cookie-authenticated, same-origin) call `assertSameOrigin(request)`. `/internal/*` handlers are cross-origin by design: they authenticate with the shared bearer token, are guarded by `DEPLOY_ENV === 'dev'` (return 404 otherwise), use NO cookie auth, and apply a CORS allowlist instead of same-origin.
- All repository queries must respect the D1 budget (§3.4): batch within 100 bound params / 100 KB / statement, paginate unbounded lists, and have a backing index.
- No realtime infra in v1. Live-looking features use request/response + light client polling behind a data interface a Durable-Object layer can replace later.
- **Styling is Tailwind CSS v4** (already configured: `@tailwindcss/postcss`, tokens in `src/app/globals.css`). Style with Tailwind utility classes bound to the design tokens; no CSS-in-JS and no ad-hoc global CSS beyond `globals.css`. shadcn/ui components are themed through these same Tailwind tokens.
- **UI is built from shadcn/ui components** wherever one fits. The repo already has a shadcn-style local registry (`src/components/ui` + `components.json`); add/generate the official component with `pnpm dlx shadcn@latest add <component>` (button, dialog, dropdown-menu, form, table, tabs, sheet, calendar, etc.) and theme it via the design tokens in `src/app/globals.css` rather than hand-rolling controls. Only write a bespoke component when shadcn has no equivalent, and build it on the same Radix/Tailwind primitives. Reuse before adding; do not duplicate an existing `ui/` component.
- Brand: headings Unna, body Source Sans; palette navy `#06192F`, white, blue `#0C315C`, light blue `#D7DFE9`, ink `#121315`, pale blue `#90B4CC`, plus supporting grays. No logo manipulation. No em dashes in UI copy, code comments, docs, commits. Plain product language; no AI-stock phrasing. Cards stay shallow (no cards inside cards). Light + dark themes (tokens already in the design export).
- **Minimalism, cross-cutting (v5, §14 v5):** prefer a small, fixed set of top-level surfaces with depth pushed into sheets/detail views over growing top-level chrome. Concretely: the mobile bottom nav stays at ~4-5 fixed slots forever; new per-org admin additions (pinned nav links, the member QR/barcode card) live inside the bottom-nav Menu sheet, never as new fixed icons. Apply the same instinct to every other admin surface added in v5 (reporting, roster, nav pins, quick links) — favor one well-organized screen over scattering controls across many.

---

## 1. Product Scope & Route Map

> **v5 change:** the content/publishing system (public `/articles` + member Library), announcements, guided tours, and the standalone events list are all cut from v1 (§11, §14 v5). Calendar is now the sole events surface, the old Events tab is repurposed into a retention-history view, and several new admin-managed surfaces (nav pins, quick links, member roster, retention reporting) are added.

### Public (unauthenticated)
- `/` — simple static landing page (org info, services/about/contact, low-emphasis Google `/signin` entry). No DB-backed article/case-study content engine in v1 (§11).
- `/signin` (low-emphasis Google entry).

### Member portal (authenticated, `/portal`, URL-addressable modules)
- `/portal` Overview, `/portal/profile` (includes a "Show my member code" action, §6 QR/barcode), `/portal/links`, `/portal/events` (repurposed: "My Retention History" — current-term points/status summary + full chronological record list with a term selector), `/portal/calendar`, `/portal/calendar/[eventId]` (event detail: RSVP, attendance, forum, media — replaces the old `/portal/events/[id]`), `/portal/surveys/[id]`.
- Mobile bottom nav stays fixed at ~4-5 core slots (Overview, Calendar, center Menu, Profile); the Menu opens a sheet containing the member QR/barcode card and any admin-pinned links (§12 J). No `/portal/library*`, no `/portal/announcements`.

### Admin (authenticated + scoped, `/portal/admin`)
- dashboard (now shows the Quick Links widget instead of an announcements widget), `roles`, `events` (approvals + QR check-in scanning, §6), `links` (moderation + embed-preview review), `retention` (manual record entry: member checklist + term/event picker + freeform reason + points), `reporting` (per-member history / per-event roster / whole-term master xlsx export), `roster` (per-term member-email allowlist), `nav-pins`, `quick-links`, `surveys`, `audit`, `members`. No `tour-settings`.

### System routes
- `/api/auth/[...nextauth]` (Auth.js: `/api/auth/signin/google`, `/api/auth/callback/google`, `/api/auth/signout`, session + csrf).
- `/l/[slug]` — short-link redirect + click capture. **Decision:** prefix route `/l/` (not bare root) so slugs do not compete with app routes and the reserved-slug surface stays small. Slugs are stored WITHOUT a leading slash (legacy `'/yhk'` row normalized on migration); the `/l/` prefix is purely a routing concern.
- `/api/uploads`, `/api/uploads/[key]` — object storage, auth-gated, server-assigned keys (§7).
- `/internal/<domain>/...` — typed shared-dev API modules (bearer-guarded, served by the dev Worker) (§3.3).
- `/api/health` — keep.

---

## 2. Environments & Infrastructure

### 2.1 Two axes (resolves the prior "shared mode is muddled" defect)
- **`DEPLOY_ENV`** ∈ `{prod, dev}` — which deployed Worker this is and which bindings it owns. `prod` → `code-nest` + `code-nest-prod-db` + `code-nest-prod-uploads`. `dev` → `code-nest-dev` + `code-nest-dev-db` + `code-nest-dev-uploads`.
- **`APP_ENV`** ∈ `{local, shared, production}` — how THIS process reads/writes data:
  - `production` → Drizzle on the local D1/R2 bindings (used by BOTH the prod Worker and the dev Worker; the dev Worker is just `DEPLOY_ENV=dev`).
  - `local` → Drizzle on better-sqlite3 (`LOCAL_SQLITE_PATH`) + filesystem/`r2-s3` storage. Core contributors with no Cloudflare access running plain `next dev`.
  - `shared` → no local DB; all data + storage calls proxy over HTTPS to the dev Worker's `/internal` API using `SHARED_API_TOKEN`. Outside developers.

| Process | DEPLOY_ENV | APP_ENV | DB | Storage |
| --- | --- | --- | --- | --- |
| Prod Worker | prod | production | D1 binding `DB` | R2 binding `BUCKET` |
| Dev Worker | dev | production | dev D1 binding `DB` | dev R2 binding `BUCKET` |
| Core contributor (local) | — | local | better-sqlite3 | fs / r2-s3 |
| Outside dev (local) | — | shared | → dev Worker `/internal` | → dev Worker `/internal` or r2-s3 |

**Fix to apply:** `wrangler.jsonc` dev env currently sets `APP_ENV: "local"`; change it to `APP_ENV: "production"` and add `DEPLOY_ENV: "dev"` (prod sets `DEPLOY_ENV: "prod"`). Update `src/server/env.ts` + `src/db/index.ts` accordingly. The dev Worker thus uses its dev bindings directly AND hosts the internal API for shared clients.

### 2.2 Migrations
- `drizzle-kit generate` from `src/db/schema.ts` → `drizzle/migrations` (ONE set, applied everywhere). Apply to remote D1 via `db:migrate:dev|prod`.
- **Local better-sqlite3 path:** apply the SAME `drizzle/migrations` SQL to the `LOCAL_SQLITE_PATH` file with the `drizzle-orm/better-sqlite3` migrator (new `db:migrate:local:sqlite` script). The current `local-sqlite.ts` hand-creating `users` is replaced by this migrator so local and D1 never diverge. (Contributors who prefer Wrangler local D1 still use `db:migrate:local --local`.)
- **Cleanup:** delete legacy `migrations/0001_code_portal_demo_schema.sql`; its demo data moves to the seed module (§9).
- **D1 FK choreography** (D1 enforces foreign keys by default): table rebuilds (notably `users`→`members`, §3.5) are RAW migration SQL applied by Wrangler — NOT runtime `batch()` code, and repositories never mutate schema. The rebuild migration's FIRST statement is `PRAGMA defer_foreign_keys = ON;` (scoped to that migration file), followed by ordered parent-before-child inserts; drizzle-kit's generated SQLite table-recreate SQL is hand-reviewed for FK-safe ordering and tested against a copy of the remote D1 before prod.

### 2.3 Secrets / config (per env via `wrangler secret put` / `.dev.vars` / `.env.local`)
- `AUTH_SECRET` (Auth.js), `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL`/`APP_BASE_URL` (per env), `trustHost: true` set in config.
- `AUTH_ALLOWED_DOMAINS`, `AUTH_ALLOWLIST_EMAILS` (consumed by the `signIn` callback).
- `SHARED_API_BASE_URL`, `SHARED_API_TOKEN` (already present). Each token maps to a seeded actor (§3.3).
- Extend `src/server/env.ts` Zod schema + conditional validation (OAuth keys required unless `APP_ENV=shared`; shared keys required when `APP_ENV=shared`; `DEPLOY_ENV` required on deployed Workers).

---

## 3. Data Access Layer

### 3.1 Problem
`local` and `production` differ only in the Drizzle driver. Replicating business logic per mode is wasteful; exposing a generic "run any op" RPC is unsafe. We want one logic layer + a safe, typed proxy for shared mode.

### 3.2 Design
1. **`getDb()`** in `src/db/client.ts`: returns `drizzle(better-sqlite3)` (APP_ENV=local) or `drizzle(env.DB)` (APP_ENV=production). Driver only.
2. **Repository layer** `src/db/repositories/*.ts` (one module per aggregate: `members`, `sessions`, `articles`, `library`, `links`, `events`, `points`, `surveys`, `announcements`, `notifications`, `calendar`, `audit`, `teams`). Pure async functions over the Drizzle handle. ALL query logic lives here, written once, used directly by the prod + dev Workers and local mode. **Every repository function takes an explicit `actor` (the resolved session member + roles) and calls `permissions.can()` before any privileged read/write, and `audit.record()` after privileged writes.** Authorization is in the repository/service layer so it holds identically across access modes.
3. **`getRepositories()`** in `src/db/index.ts`: returns the Drizzle-backed repositories for `local`/`production`, or the HTTP-backed implementation for `shared`.

### 3.3 Shared-dev internal API (resolves "no authz shape" + "no giant switch")
- **Per-domain typed modules**, not one dispatcher: `src/app/internal/<domain>/route.ts` (e.g. `members`, `library`, `links`, `events`, `surveys`, `announcements`, `audit`). Each operation is an explicit, named, Zod-validated endpoint.
- A shared contract `src/db/contract/*.ts` defines, per operation: input schema, output schema, `auth: 'public' | 'member' | 'admin'`, required `permission` (if any), and `sharedDev: 'allow' | 'deny'` (destructive/admin ops default `deny` in shared mode). The HTTP client and the route handlers are both generated/typed from this contract, so the transport stays DRY without a mega-switch.
- **Actor model for shared mode:** `SHARED_API_TOKEN` is a credential the dev Worker maps (via a `shared_dev_tokens` seed table or a config map) to a specific seeded `members` row + role set. The internal handler resolves that actor, then runs the SAME repository function with the SAME `permissions.can()` checks and audit writes as in-app. Outside devs can be issued different tokens to exercise member vs. admin paths. This keeps shared mode credential-free, authorization-faithful, and audited.
- **Transport security:** `/internal/*` does NOT use `assertSameOrigin` (cross-origin by design). Each handler (1) returns 404 unless `DEPLOY_ENV === 'dev'` so the routes are inert on the prod Worker even though Next deploys the code to both; (2) requires the shared bearer token and resolves it to a seeded actor via `shared_dev_tokens`; (3) uses no cookie auth; (4) applies a CORS allowlist. `src/server/env.ts` rejects any shared-dev token config when `DEPLOY_ENV='prod'`.
- **Storage over the proxy:** the existing `src/storage/adapters/shared-api.ts` expects `/internal/uploads`. Add it to the contract as a typed op with token→actor authz, server-assigned keys, content-type/size limits, and the same `DEPLOY_ENV='dev'` guard (mirrors §7).
- Destructive/admin ops require BOTH the actor's permission AND `sharedDev: 'allow'`.

### 3.4 D1 budget (binding acceptance criteria for every repo function)
- ≤ 100 bound parameters and ≤ 100 KB per SQL statement; chunk bulk writes (seed, fan-out) into batches that respect this.
- No unbounded `SELECT`; list endpoints paginate (cursor or limit/offset) with a sane default + max page size.
- Each query has a backing index (§6.x). Reviews reject a query with no index.
- Avoid per-request query storms; prefer set-based queries and `db.batch()` for multi-statement writes (single round trip, implicit transaction). No long-running transactions (D1 has no interactive transactions; use `batch()`).
- Keep per-request query count modest; treat large fan-outs as a smell (see notifications §6, calendar §6).

### 3.5 `users` → `members` reconciliation (inventory-first)
- **Phase 0 task, before writing the migration:** inventory the actual remote dev + prod D1 schemas (`wrangler d1 execute ... "SELECT name,sql FROM sqlite_master"`) to learn what is really deployed (Drizzle `0000` created only `users`; the legacy `migrations/0001` `members/resources/...` set may or may not have been applied).
- Pre-launch, with no real prod users, **recommended path: a clean reset of dev + prod D1** to the new schema, documented in `docs/operations/migrations.md`. If inventory shows real data, fall back to an additive migration: create `members`, backfill from `users`, keep a temporary compatibility view/route, then drop `users` in a later migration. Either way, port `/api/users` + its tests to `/api/members` (or retire them).
- Auth identity lives in the Auth.js `accounts` table (`provider='google'`); `members` is the Auth.js user. Additional providers are structurally supported by `accounts` but only Google is configured for v1.

---

## 4. Auth & Sessions

Auth is **Auth.js v5 (`next-auth`)** with the **`@auth/drizzle-adapter`** pointed at our `getDb()` Drizzle instance, so Auth.js's own tables live in OUR schema and migration set (no second source of truth, no raw `@auth/d1-adapter` tables to reconcile). Google is the only configured provider for v1; the `accounts` table makes additional providers structurally free later (deferred).

### 4.1 Configuration (`src/auth.ts`)
- **Lazy initialization (required on Workers):** use Auth.js lazy config — `export const { handlers, auth, signIn, signOut } = NextAuth(async (req) => ({ adapter: DrizzleAdapter(getDb(), {...ourTables}), providers: [Google], session: { strategy: 'database' }, callbacks }))` — so the adapter and `getDb()` are constructed inside request/runtime context, never at import/build time. `getDb()` returns a lazy handle that calls `getCloudflareContext()` only on first use (avoids `next build`/static-analysis failures). Database sessions (not JWT) give revocable, server-stored sessions in the `sessions` table.
- App Router handlers: `src/app/api/auth/[...nextauth]/route.ts` → `export const { GET, POST } = handlers`. Sign-in/out via the exported `signIn`/`signOut`; `/signin` is a thin page calling `signIn('google')`.
- `AUTH_SECRET` set per env; `trustHost: true` (required behind the Worker proxy); `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` from env.

### 4.2 Domain gate + provisioning (takeover-safe by default)
- **`signIn` callback** rejects unless `account.provider==='google'` AND `profile.email_verified===true` AND (`profile.email` domain ∈ `AUTH_ALLOWED_DOMAINS` OR `profile.email` ∈ `AUTH_ALLOWLIST_EMAILS`) **AND `profile.email` ∈ the current active term's roster** (§6 `term_member_roster`, v5). Optionally pass `hd` in `authorization.params` as a hint (not a security boundary; the callback is authoritative).
- **v5 roster gate:** being on the current term's roster is now required to sign in, not just a membership-tracking nicety. A new term's roster is seeded as a copy of the previous term's (admin then removes leavers / adds newcomers) rather than starting blank. An already-provisioned member who falls off the current term's roster is flipped to `status='inactive'` (locked out; historical records are kept for past-term reporting) — see §14 v5.
- **No `allowDangerousEmailAccountLinking`** (Auth.js default false) → the round-1 email-takeover concern is handled by the library: a Google identity links only to an account already holding that exact provider account, never auto-merging by email.
- **Base membership is implicit, not a stored grant:** every `members` row with `status='active'` IS a base member; `member_roles` stores ONLY elevated scopes. This removes the failure mode where an Auth.js `events.createUser` side effect could leave a user with no base role. The `createUser` event is used only for an audit row + ensuring `status='active'`.
- **No pre-provisioning by email (v1):** with dangerous email-linking off, a real member row is created ONLY by that person's first Google sign-in. Admins do NOT create login-able member rows by email (that would collide with Auth.js `createUser` on first sign-in); admin member management edits already-signed-in members and assigns elevated roles. An invite/link flow is deferred. (Seeded dev members are demo data on dev/local only and are exercised in shared mode via `shared_dev_tokens`, not real Google sign-in.)

### 4.3 Members = Auth.js user, plus roles on the session
- Our `members` table IS the Auth.js `user` table, extended with CODE fields (§6). The adapter's required `accounts` + `sessions` + `verification_token` tables are defined in our Drizzle schema via the adapter's schema helpers. All CODE columns are nullable/defaulted so the adapter's `createUser` (which inserts only `id/name/email/email_verified/image`) succeeds.
- **`session` callback** attaches the member's resolved elevated roles to `session.user` (single query keyed by `member_roles.member_id`) so feature code reads `{ member, roles }` without re-querying. `auth()` is the single accessor used by layouts, server actions, and route handlers.

### 4.4 Where validation runs (resolves overstated middleware claim)
- **Phase 0 spike (required):** determine whether Auth.js's `auth()`/D1 works in Next middleware under OpenNext across (a) `next dev` with `initOpenNextCloudflareForDev()`, (b) `opennextjs-cloudflare preview`, (c) a deployed Worker. Record the result in `docs/architecture/auth.md`. (Auth.js database-session strategy needs DB access in middleware, which is the open question; JWT strategy would avoid it but loses easy revocation — we keep database sessions and validate in layouts unless the spike proves middleware-DB is safe.)
- Default: middleware does only a cheap session-cookie-presence redirect for `/portal/*`; authoritative `auth()` + role checks run in the `/portal` and `/portal/admin` layouts, server actions, and route handlers.

### 4.5 CSRF / hardening
- Auth.js provides built-in CSRF protection for its own routes. For our OWN mutating `/api/*` route handlers and server actions, enforce `assertSameOrigin(request)` (cookie-authenticated, same-origin); tested with a rejected cross-origin POST. `/internal/*` is exempt and uses bearer + `DEPLOY_ENV=dev` guard + CORS allowlist (§3.3).
- Rate-limit the auth routes, link creation, and scan submission (simple D1/KV counter or CF rule).

### 4.6 Shared mode and Auth.js
- Auth.js runs the real session flow in `local` (optional, needs Google creds), the dev Worker, and prod. In `shared` mode an outside dev has no Google creds and does not run Auth.js: the app uses a dev-session shim resolved from `SHARED_API_TOKEN` → seeded actor (§3.3), so identity + data both come from the token-mapped actor. `auth()` is wrapped by `getActor()` which returns the Auth.js session in real modes and the token-mapped actor in shared mode, giving feature code one uniform `{ member, roles }`. `getActor()` imports `auth()` lazily/dynamically so the Auth.js module + adapter are never loaded when `APP_ENV='shared'`.

---

## 5. Authorization (RBAC)

- Roles: `super`, `member`, `calendar`, `link`, `retention`, `member_admin` (seeded from the design's `ROLE_DEFS`). `super` inherits all scopes (resolved in code). **v5:** `crs` is renamed `retention` — same people/scope, renamed because it now also covers manual retention records (§6, §14 v5), not just event points. `publishing` is dropped along with the content/publishing system (§11 v5); reinstate it if that system returns.
- `src/server/auth/permissions.ts`: `can(actor, action, resource?)` over a single action enum (`event:approve`, `points:assign`, `retention:record`, `link:moderate`, `role:assign`, `survey:configure`, `member:manage`, `roster:manage`, `nav:configure`, ...). Pure, exhaustively unit-tested. (`content:publish` / `library:read_confidential` dropped with the content/publishing system, v5.)
- Enforced in repository/service functions (so it holds across access modes), admin layouts (gate by scope), and ownership checks (member edits only own link/list/comment unless holding the relevant admin scope). Confidential library access also checks team membership / ACL (§6).
- Every successful admin mutation → `audit.record(actor, action, targetType, targetId, detail, category)`.

---

## 6. Data Model (Drizzle, SQLite dialect)

> **v5 change:** the content/publishing tables (`articles*`, `topics`, `comments`, library favorites/lists) and `announcements`/`member_feed_state.announcements_seen_at` are dropped — that subsystem is deferred (§11, §14 v5). `point_awards` is replaced by a unified `retention_records` table. New tables: `term_member_roster`, `nav_pins`, `quick_links`. `members` drops `tour_member_done`/`tour_admin_done`. `short_links` gains embed-preview columns.

One `schema.ts` (split into `schema/` re-exported if it grows). IDs are app-generated prefixed strings (`src/lib/ids.ts`). Timestamps are integer epoch-ms (`mode:"timestamp_ms"`) consistently. FK `references()` are declared (D1 enforces them) — migrations honor FK-safe ordering (§2.2). **Every table's indexes are listed; a query without a backing index fails review.** Drizzle TS property names are camelCase mapping to snake_case SQL columns; the Auth.js adapter relies on EXACT property names — `emailVerified` → column `email_verified`, `sessionToken` → `session_token`, `userId` → `user_id` — so those tables use the adapter's expected property names even though columns below are shown in SQL form.

**Identity & access** (Auth.js `@auth/drizzle-adapter` tables live here; `members` IS the Auth.js `user` table, extended)
- `members(id pk, email unique, email_verified timestamp_ms null, name null, image null, full_name null, nickname null, pronouns null, batch null, birthday null, birthday_private bool default true, avatar_key null, status['active'|'pending'|'inactive'] default 'active', created_at, updated_at)` — idx: `email`, `status`. (`name`/`image`/`email_verified` are Auth.js fields; all CODE fields are nullable/defaulted so adapter `createUser` succeeds and profile is completed later. **v5:** `tour_member_done`/`tour_admin_done` dropped — guided tours are cut, §11.)
- `accounts(user_id fk→members.id, type, provider, provider_account_id, refresh_token null, access_token null, expires_at null, token_type null, scope null, id_token null, session_state null, pk(provider, provider_account_id))` — idx: `user_id`. Google identity (the old `google_sub` is now `provider='google' + provider_account_id`). No `allowDangerousEmailAccountLinking`.
- `sessions(session_token pk, user_id fk→members.id, expires)` — Auth.js database-session table (replaces the prior custom hashed-token table) — idx: `user_id`.
- `verification_token(identifier, token, expires, pk(identifier, token))` — adapter-required even though OAuth-only.
- `roles(id pk, key unique, label, description, kind)`; `member_roles(member_id fk→members.id, role_id fk, assigned_by fk null, assigned_at, pk(member_id, role_id))` — idx: `role_id`.
- `shared_dev_tokens(token_hash pk, member_id fk, label, created_at)` — maps shared bearer tokens to seeded actors (dev Worker only; never seeded into prod).
- **`term_member_roster(term_id fk, email, member_id fk null, added_by fk, added_at, pk(term_id, email))`** — idx: `term_id`, `email`. **v5, new.** The auth gate (§4.2): an email must appear here for the *current active* term to sign in. `member_id` is backfilled once that email's member row exists (nullable beforehand since roster entries can be added before someone's first sign-in). A new term's rows are seeded by copying the prior term's roster; admins then edit (`roster:manage` permission, under the renamed `retention` scope... actually under `member_admin`, since this is membership gating not points — confirm in implementation plan if ambiguous).

**Consultancy teams** — **v5: dropped.** These existed only to support confidential-content ACLs (`article_acl`) in the now-deferred content/publishing system. Reinstate alongside that system if/when it returns.

**Content / publishing — v5: entire subsystem deferred (§11).** `articles`, `article_sections/components/questions/refs`, `topics`, `article_topics`, `article_related`, `article_acl`, `favorites`, `lists`/`list_items`, `comments` are all removed from the v1 schema. The data model (e.g. `article_related` + `topics` for graph search) is preserved in the design memory for when this work resumes — see the existing `deferred-library-graph-search` note, now nested under this broader deferral.

**Short links**
- `short_links(id pk, slug unique, destination_url, title, owner_member_id fk, click_count int default 0, preview_title null, preview_description null, preview_image_key null, created_at, updated_at)` — idx: `slug`, `owner_member_id`. `destination_url` validated http/https only (open-redirect guard). **v5:** `preview_title`/`preview_description`/`preview_image_key` are new, nullable — owner-controlled embed/OG preview shown when the link is shared in chat apps (§7, §14 v5). `preview_image_key` is an R2 object key under the existing uploads namespace pattern.
- `reserved_slugs(slug pk)` (seeded).
- **Analytics (rollup-primary, resolves D1 write-storm risk):** `link_daily_stats(link_id fk, date, referrer_bucket, device_bucket, count, pk(link_id, date, referrer_bucket, device_bucket))` is the source of truth for the 30-day series + referrer/device breakdowns the design shows. The `/l/[slug]` redirect resolves and 302s immediately, then records analytics (one upsert-increment into `link_daily_stats` + bump `short_links.click_count`) via `runInBackground()` (a `ctx.waitUntil` wrapper from `src/server/cloudflare.ts`) AFTER responding — analytics is fail-open and must never block or fail the redirect. Raw `link_events` are NOT stored in v1 (optional sampled+TTL later). idx: `(link_id, date)`.
- **Embed/OG preview control — v5, new (§14 v5):** `/l/[slug]` branches on user-agent. Known crawler/bot UAs (`facebookexternalhit`, `Twitterbot`, `Slackbot`, `Discordbot`, etc., a maintained allowlist in `src/lib/`) are served a small HTML page with `<meta property="og:title">`/`og:description`/`og:image` populated from `preview_title`/`preview_description`/`preview_image_key` (falling back to `title`/destination metadata if unset) instead of a 302 — this is what produces a controlled preview card when the link is pasted into Messenger/Slack/etc. Everyone else still gets the instant 302. This crawler branch must not affect the analytics fail-open guarantee above.

**CRS events**
- `crs_events(id pk, title, type['official'|'casual'|'birthday'], status['pending'|'approved'|'rejected'], points null, place, capacity null, starts_at, ends_at null, description, created_by fk, approved_by fk null, approved_at null, checkin_secret, created_at)` — idx: `status`, `starts_at`, `type`, `created_by`. **v5:** `checkin_secret` stays but the workflow it backs flips — see `crs_attendance` below.
- `event_rsvps(event_id fk, member_id fk, state['going'|'none'], updated_at, pk(...))` — idx: `member_id`.
- `crs_attendance(event_id fk, member_id fk, scanned_at, scanned_by fk, pk(event_id, member_id))` — idx: `member_id`. **v5 QR/barcode flip:** the table is structurally unchanged, but the workflow inverts — each MEMBER carries a static, permanent QR/barcode (client-generated from their member id, no rotation/OTP). An event admin picks the event/session first, then scans a stream of member codes against it (`scanned_by` = the scanning admin); a manual search-by-name/email fallback exists for when scanning fails. Previously the event held the rotating code and members scanned it — that model is replaced.
- `event_media(id pk, event_id fk, r2_key, caption null, uploaded_by fk, created_at)` — idx: `event_id`.
- `event_forum_posts(id pk, event_id fk, member_id fk, anonymous bool, parent_id fk null, body, created_at)` — idx: `(event_id, created_at)`, `parent_id`. **Anonymity:** `member_id` is ALWAYS stored (for moderation); when `anonymous=true` the API never returns author identity to members or normal admins; only `super` may reveal via an audited action.

**Retention records** (derived status, not stored as truth) — **v5: replaces `point_awards`**
- `terms(id pk, name, retained_at int, probation_below int, starts_at, ends_at)` — idx: `(starts_at, ends_at)`. This is the "school year" the rest of v5 keys off of (history view, roster, reporting exports).
- `retention_records(id pk, member_id fk, term_id fk, event_id fk null, points null, reason, source['event_attendance'|'manual'] default 'manual', recorded_by fk, recorded_at)` — idx: `(member_id, term_id)`, `term_id`, `event_id`. **v5:** one row covers BOTH event-derived point awards (`source='event_attendance'`, `event_id` set) AND manual retention-admin entries (`source='manual'`, `event_id` optional) — e.g. "submitted the required medical waiver" with no points, or a logged violation with negative `points`. `points` is nullable (a record can be purely informational) and may be negative (deductions are allowed, confirmed in §14 v5). No admin-managed catalog/lookup table for record types — `reason` is freeform text entered per record; the manual-entry UI is a member checklist (multi-select) + term/event picker + freeform reason + optional point value. Retention status + leaderboard stay query-derived per `term_id`; if profiling shows hot paths, add a cached `member_term_points` rollup later (not v1 truth). Because every record carries `term_id`, a member's point total naturally resets to 0 at the start of a new term with no extra carry-over logic.

**Surveys** (true anonymity via assignment token) — **v5:** unchanged structurally; the only behavior cut is automatic creation/triggering of a survey when an event closes (§11, §14 v5). Surveys (including ones tied to an event via `event_id`) remain a manual admin-created feature.
- `surveys(id pk, event_id fk null, title, status['draft'|'running'|'closed'], sample_size null, created_by fk, created_at)` — idx: `status`, `event_id`.
- `survey_questions(id pk, survey_id fk, position, type['scale'|'text'|'choice'], prompt, options_json null)` — idx: `survey_id`.
- `survey_assignments(survey_id fk, member_id fk, response_token_hash unique, assigned_at, completed_at null, pk(survey_id, member_id))` — idx: `member_id`, `response_token_hash`. Random sample writes selected members + a per-assignment opaque token (only its hash is stored).
- `survey_responses(id pk, survey_id fk, submitted_at)` + `survey_answers(id pk, response_id fk, question_id fk, value)`. **Responses carry ONLY `survey_id`** — no `member_id`, no assignment ref, no token — so there is NO join key from a response back to a member. Submit flow: client sends the raw token; server runs a conditional `UPDATE survey_assignments SET completed_at=now WHERE response_token_hash=? AND completed_at IS NULL` and proceeds ONLY if it affected exactly 1 row (enforces one-submit + valid token), then inserts the anonymous `survey_responses`/`survey_answers` via `db.batch()`. (A crash between the update and the insert leaves an assignment marked complete with no response — a rare, acceptable lost slot; documented.)

**Notifications** — **v5: `announcements` subsystem dropped entirely** (admin CRUD, the `/portal/announcements` page, its dashboard widget — replaced by `quick_links` below — and its slice of `member_feed_state`/the calendar contract). What remains:
- `member_feed_state(member_id pk, surveys_seen_at, events_seen_at)` — cheap per-member cursor for deriving unread counts (survey assignments, newly available events) WITHOUT fanning out a row per member per item. **v5:** `announcements_seen_at` dropped with the announcements subsystem.
- `notifications(id pk, member_id fk, kind, title, body, href null, read_at null, created_at)` — idx: `(member_id, read_at, created_at)`. **Only materialized for genuinely per-member events** (comment reply to you, your attendance confirmed, points awarded to you, your link milestone). Survey/event-availability "notifications" are DERIVED from `survey_assignments` + `member_feed_state` at read time, not fanned out. **v5:** the feed/bell itself stays; only the notification-settings/preferences page is cut (§11, §14 v5) — there is no per-member notification-preference data to model.

**Nav pins & quick links** — **v5, new.** Two intentionally separate admin-managed lists (confirmed distinct, §14 v5) even though their row shape is similar:
- `nav_pins(id pk, label, url, icon, position int, created_by fk, created_at, updated_at)` — idx: `position`. Visible to every signed-in member (no per-role scoping in v1). `url` may be external or an internal app path. Rendered as extra top-nav items on desktop; on mobile they render as rows inside the bottom-nav Menu sheet (alongside the member QR/barcode card, §6 CRS events) rather than becoming new fixed bottom-nav icons — keeps the bar at ~4-5 slots regardless of pin count (§12 minimalism note, §14 v5).
- `quick_links(id pk, label, url, position int, created_by fk, created_at, updated_at)` — idx: `position`. Powers the dashboard's Quick Links widget (masterfile, member directory sheet, admin guidebook, constitution, finance guide, etc.) that replaces the old announcements widget. Not the same list as `nav_pins`.

**Reporting** — **v5, new.** No new tables; the per-member / per-event / whole-term xlsx exports (§12, §14 v5) are query views over `retention_records` + `crs_events`/`event_rsvps`/`crs_attendance`, filtered per export. Lives behind a new admin `reporting` route and the renamed `retention` permission scope.

**Audit**
- `audit_logs(id pk, actor_member_id fk, actor_context['session'|'shared_dev_token'] default 'session', shared_token_hash null, shared_token_label null, action, target_type, target_id, detail null, category['role'|'event'|'retention'|'survey'|'link'|'member'], created_at)` — idx: `(category, created_at)`, `actor_member_id`. In shared mode the token-mapped actor is recorded as `actor_member_id` with `actor_context='shared_dev_token'` plus the token label, so attribution between two devs sharing one seeded actor is never ambiguous. **v5:** `category` drops `'content'` (no publishing system) and gains `'retention'` (manual record entries, roster edits).

**Calendar — derived, with an explicit contract**
- No table. `calendar.getMonth(actor, range)`: union of approved `crs_events` whose audience the actor can see, members' birthdays where `birthday_private=false` OR actor has `member:manage`, and term deadlines. Bounded date window (single month/agenda page); each source query indexed and date-bounded. Birthday privacy is enforced in the contract. **v5:** the published-announcements source is dropped (announcements subsystem cut); Calendar is now the sole events discovery surface — there is no separate events list page, and clicking an event opens its detail (RSVP/attendance/forum/media) at `/portal/calendar/[eventId]` (§1, §14 v5).

---

## 7. Storage (R2) — hardened in Phase 1 (resolves wide-open upload defect)

- Uses the existing `StorageAdapter` (binding / r2-s3 / local-fs / shared-api).
- **`/api/uploads` (POST):** require an authenticated session; the SERVER assigns the key from a fixed namespace based on purpose + actor (`avatars/{memberId}`, `events/{eventId}/{mediaId}`, `links/{linkId}/preview` — v5, §14 v5). The client may NOT supply `key`/`x-object-key`. Validate content-type against an allowlist (images) and enforce a max size. Authorize the namespace (e.g., event media requires the member can post to that event; a link preview image requires the actor own that `short_links` row).
- **`/api/uploads/[key]` (GET):** authorize by namespace (event media = members; avatars = members; link preview images = public, since they're served to crawlers, §14 v5). **DELETE:** require session + ownership/admin; remove the current unauthenticated DELETE entirely.
- QR codes generated client-side on demand (light/dark/transparent/logo); persisting to R2 deferred (YAGNI v1). **v5:** the same client-side-generation approach is used for each member's static attendance QR/barcode (§6 CRS events) — generated on demand from the member id, never persisted to R2.

---

## 8. Testing Strategy

- **Phase 0 adds deps + scripts:** `next-auth@5`, `@auth/drizzle-adapter`, `vitest`, `@cloudflare/vitest-pool-workers`, `@vitest/...`; `"test"`, `"test:watch"`, `"db:migrate:local:sqlite"` scripts. (`better-sqlite3`, `zod`, `drizzle-kit` already present.)
- **Unit (Vitest, node):** `permissions.can()` matrix; slug + reserved-slug + destination-URL validation; point/retention computation; survey seeded-RNG sampling (deterministic); session hashing; audience resolution; calendar assembly; `assertSameOrigin`.
- **Integration (`@cloudflare/vitest-pool-workers`):** repositories against an ephemeral D1 with `drizzle/migrations` applied in `beforeAll`; route handlers — auth callback (mocked Google token endpoint, including the takeover-fallback guard), `/l/[slug]` redirect + daily-stat upsert, RSVP, check-in scan (anti-replay), publish gating, confidential-ACL gating, upload authz (rejects caller key, rejects unauth GET/DELETE), cross-origin POST rejection.
- **Shared-mode parity test:** for representative ops, assert the Drizzle path and the `/internal` proxy path return equal results AND enforce the same authz (a `sharedDev:'deny'` op is refused over the proxy).
- **Migration test:** `drizzle-kit generate` is clean (no uncommitted drift); the `users→members` migration applies on a seeded copy with FK deferral.
- **E2E (Playwright, light, Phase 9 — v5 renumbering, was Phase 10):** sign-in (mocked OAuth), create link, RSVP + simulated scan, log a manual retention record, assign role. (Article publishing dropped from this list, v5 — content/publishing deferred, §11.)
- **CI gates:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, clean `drizzle-kit generate`, `pnpm build` (OpenNext).

---

## 9. Seeding

- `src/db/seed/data.ts` from the design files (`design/data.jsx`, `member-*-data.jsx`, `admin-data.jsx`): members, roles, a term + `term_member_roster`, short links (incl. embed-preview fields) + reserved slugs + seeded `link_daily_stats`, CRS events (upcoming + past) + forum posts + attendance, `retention_records` (event-derived + a few manual entries), one running survey + assignments, `nav_pins` + `quick_links` samples, audit samples, and (dev only) `shared_dev_tokens`. **v5:** teams and confidential-articles seed data dropped with the deferred content/publishing system (§11); announcements seed data dropped (§11).
- `src/db/seed/run.ts` idempotent (insert-or-ignore by id), batched within the D1 budget. Scripts `db:seed:local`, `db:seed:dev`. Never runs against prod.

---

## 10. Security Considerations

- Sessions: Auth.js database sessions (`sessions` table), httpOnly/Secure cookie, revocable; sign-out deletes the row. `AUTH_SECRET` per env; `trustHost: true`.
- Server-side authz in repositories on every mutation + admin read; ownership + team/ACL checks.
- Uploads: auth + server-assigned keys + content-type/size limits + authorized GET/DELETE.
- Auth.js CSRF for auth routes; `assertSameOrigin` on our own mutating `/api/*` handlers + server actions; rate limits on auth/link-create/scan.
- Short-link destination validation (http/https) to block open-redirect abuse.
- Shared API: bearer token → seeded actor; per-op `auth`/`permission`/`sharedDev` gating; no raw SQL; rotation documented; destructive ops denied in shared mode.
- No secrets client-side; bindings confined to adapters/internal modules.
- PII (emails, birthdays) members-only; never on public routes; birthday privacy honored in calendar.

---

## 11. Explicitly Deferred (recorded so they resurface)

1. **The entire content/publishing system — v5, newly deferred.** Both the public OD-publishing site (`/articles`, `/articles/[slug]`, ex-Phase 2) and the signed-in member Library (favorites/lists/comments/confidentiality-ACL, ex-Phase 4) are cut from v1. This was previously in scope (v1-v4); it moved to deferred after the v5 stakeholder-driven revision (§14 v5). When it resumes, restore `articles*`, `topics`, `comments`, `favorites`/`lists`, `consultancy_teams`/`team_members`/`article_acl`, the `publishing`/`library:read_confidential` permissions, and the public `/articles` routes — all removed from §1/§5/§6 in this revision.
   - **Graph / semantic library search** (the library "graph search" path) was already deferred-within-this-deferral before v5. Candidates: Cloudflare Vectorize + Workers AI embeddings over the corpus, or a graphify-style knowledge graph traversing `article_related` + `topics` (both already in the model, when restored). *(Saved to project memory.)*
2. **Announcements — v5, newly deferred.** Admin CRUD, the `/portal/announcements` page, its dashboard widget (now occupied by Quick Links, §6/§12), and its slice of the calendar contract / `member_feed_state`. Restore `announcements` + `member_feed_state.announcements_seen_at` + the calendar's announcement-audience union if/when it returns.
3. **Guided tours — v5, newly deferred.** `tour_member_done`/`tour_admin_done` dropped from `members`; the "start tour" settings action and Phase 9's "guided tours (replayable)" deliverable are cut. Reinstate as new columns + a new admin/member surface, not a revert, since the columns are being dropped now rather than left unused.
4. **Notification settings/preferences page — v5, newly deferred.** The underlying notification feed/bell stays; only a page to configure preferences is cut, since there's currently no preference data to configure.
5. **Survey auto-trigger-on-event-close — v5, newly deferred.** Surveys remain fully usable as a manual admin-created feature (including tying one to an `event_id`); only the automation that would create/launch a survey automatically when an event ends is cut.
6. **Realtime** live check-in feed + forum via Durable Objects + WebSockets (v1 polls behind the same data interface).
7. **Email** (Cloudflare Email Service) for announcement digests / alternative auth. (Moot for "announcement digests" while announcements are deferred per #2; alternative-auth use case still stands.)
8. **Additional auth providers** (the `accounts` table already supports them; only Google is wired for v1).
9. **Advanced link analytics** (raw event sampling, geo, bot filtering, UTM) — distinct from the v5 embed/OG preview control (§6, §7), which IS in v1 scope.

---

## 12. Phased Build Sequence

> **v5 restructure (§14 v5):** ex-Phase 2 (public content site) and ex-Phase 4 (Library) are removed — that subsystem is deferred (§11). The roster-as-auth-gate folds into Phase 1. QR/barcode attendance folds into the CRS-events phase (renumbered Phase 4). Manual retention records get their own new Phase 5. Reporting/export, nav pins, and quick links fold into the admin phase (renumbered Phase 8). Phases are renumbered 0-9 (was 0-10).

Bottom-up; each phase ends with working, tested software and gets its own task plan.

- **Phase 0 — Foundations + spikes:** add deps/scripts/test harness; **middleware-D1 spike** (§4.3); **D1 schema inventory** of remote dev/prod (§3.5); finalize `schema.ts` (all tables + indexes); generate migration; delete legacy `migrations/`; `users→members` reset/migration with FK choreography; `DEPLOY_ENV`/`APP_ENV` split in `wrangler.jsonc` + `env.ts` + `db/index.ts`; `getDb()` + repository skeletons + contract; seed module; **shared-Worker lifecycle docs in AGENTS.md / README.md / CLAUDE.md / docs (§15)**. *Acceptance:* migrations apply local+dev; seed loads within budget; repo + shared-parity tests green; spike documented; redeploy obligations written into AGENTS/README/CLAUDE; shared-dev deploy CI/PR guard in place (§15). *(Already built — see `git log`.)*
- **Phase 1 — Auth, RBAC, Upload hardening, Roster gate:** Auth.js Google flow (`@auth/drizzle-adapter`, DB sessions) + `signIn`-callback domain gate + **`term_member_roster` check (v5, §4.2, §6)** + base-role provisioning; `getActor()` unifying real + shared-mode actors; `permissions.can()` (incl. renamed `retention` scope, dropped `publishing`/`library:read_confidential`); `/portal` layout gate; profile (incl. "Show my member code" entry point, v5); sign-out; **harden `/api/uploads` + `/api/uploads/[key]` now** (before any feature uses R2). *Acceptance:* domain-AND-roster-restricted sign-in (off-roster email is rejected even if domain matches); off-roster existing members flip to `inactive`; role-gated test route; permission matrix tested; uploads reject caller keys + unauth GET/DELETE. *(Mostly already built — see `git log`; roster-gate addition is new work.)*
- **Phase 2 — Public landing + Portal shell + Overview + Notifications:** simple static `/` (org info, services/about/contact, `/signin` entry — no DB-backed content engine, v5); authed shell, URL-addressable modules, overview, notifications (materialized + derived, settings page cut per §11).
- **Phase 3 — Short links:** CRUD + ownership, reserved/format/destination validation, `/l/[slug]` redirect + daily-stat upsert, **embed/OG preview control (crawler-UA branch + `preview_title`/`preview_description`/`preview_image_key`, v5, §6/§7)**, analytics views, QR export, admin moderation.
- **Phase 4 — CRS events + retention:** create→approve, RSVP, **member-carried static QR/barcode + event-admin scan flow with manual-search fallback (v5, replaces the old rotating-secret/member-scans model, §6)**, attendance, media (R2), forum (anonymity rules), **unified `retention_records` (event-derived + manual entries, v5) + retention status + leaderboard**.
- **Phase 5 — Manual retention records:** admin UI for logging non-event retention records — member checklist (multi-select) + term/event picker + freeform reason + optional (possibly negative) points (v5, §6). Depends on Phase 4's `retention_records` table.
- **Phase 6 — Surveys:** create, random sample + tokens, anonymous response flow, admin results (identity-free). No auto-trigger on event close (§11).
- **Phase 7 — Calendar + My Retention History:** derived calendar with the §6 contract (announcement source removed, v5) as the sole events discovery surface; event detail at `/portal/calendar/[eventId]`; the repurposed "Events" tab as **My Retention History** (current-term summary card + full record list + term selector, v5, §1/§6); notification derive+materialize on approve/assign/reply/points-awarded.
- **Phase 8 — Admin + Audit + Reporting + Nav/Quick Links + Roster mgmt:** roles management (super inheritance, renamed `retention` scope), scoped queues (CRS approvals, link moderation), audit view + filters, dashboard metrics + **Quick Links widget (v5, replaces announcements widget)**, member management, **per-term roster admin screen (v5, §6 `term_member_roster`)**, **admin-pinned nav links screen (v5, §6 `nav_pins`)**, **reporting screen with the three xlsx exports — per-member history, per-event roster, whole-term master (v5, §6 "Reporting")**. No guided tours (§11).
- **Phase 9 — Hardening:** rate limits, security review, Playwright E2E, OpenNext caching pass (§13), docs refresh, shared-dev onboarding verification.

---

## 13. Caching (OpenNext) — note

`open-next.config.ts` already exists (minimal defaults). Decisions: everything under `/portal/*` is dynamic (`export const dynamic = 'force-dynamic'` or per-request `cookies()` access forcing dynamic). **v5:** `/` is now a simple static landing page (no DB-backed content, §1/§11) and can render fully static/ISR with no cache-invalidation concerns; this replaces the prior SSR-article-pages note, which no longer applies now that the content/publishing system is deferred. The short-link redirect is dynamic.

---

## 14. Revision Log & Review Resolutions

**v2 (after Codex adversarial round 1 — verdict was needs-rework):**

| # | Finding (sev) | Resolution |
| --- | --- | --- |
| 1 | Shared mode muddled (blocker) | §2.1 split `DEPLOY_ENV` vs `APP_ENV`; dev Worker = `DEPLOY_ENV=dev, APP_ENV=production` + hosts internal API; fix `wrangler.jsonc`. |
| 2 | RPC no authz shape (blocker) | §3.2–3.3 authz moved into repositories with explicit `actor`; contract declares `auth`/`permission`/`sharedDev`; token→seeded-actor; audit coupled. |
| 3 | Uploads wide open (blocker) | §7 + Phase 1: server-assigned keys, auth, content-type/size limits, authorized GET, remove unauth DELETE — done before any R2 feature. |
| 4 | Middleware claim overstated (major) | §4.3 added a Phase 0 spike across dev/preview/deployed; default to layout validation pending proof. |
| 5 | D1 enforces FKs (major) | §2.2 FK choreography with `defer_foreign_keys` + ordered backfill + tested on remote copy. |
| 6 | D1 limit budgeting absent (major) | §3.4 explicit budget as repo acceptance criteria. |
| 7 | Missing indexes (major) | §6 every table lists indexes; no-index query fails review. |
| 8 | Link analytics not v1-safe (major) | §6 `link_daily_stats` rollup is source of truth; no per-click rows in v1. |
| 9 | Session crypto under-specified (major) | §4.2 opaque random token + `sha256` (no secret); `OAUTH_STATE_SECRET` only for OAuth-state HMAC. |
| 10 | CSRF incomplete (major) | §4.4 `assertSameOrigin` on all mutating `/api/*` + `/internal/*` + tests. |
| 11 | OAuth email-fallback takeover (major) | §4.1 fallback only when `google_sub IS NULL` + active + allowed verified email + audit. |
| 12 | users→members hand-waved (major) | §3.5 inventory-first; recommend clean reset pre-launch, additive+backfill otherwise. |
| 13 | Confidentiality ACL missing (major) | §6 `consultancy_teams` + `team_members` + `article_acl` + `library:read_confidential`. |
| 14 | Anonymity not real (major) | §6 surveys store `response_token` not member; forum stores member but hides identity (super-only reveal). |
| 15 | Notifications over-scoped (major) | §6 hybrid: derive announcement/survey/availability via `member_feed_state`; materialize only per-member events. |
| 16 | One giant RPC switch (major) | §3.3 per-domain typed modules under `src/app/internal/<domain>`, not a dispatcher. |
| 17 | Deps don't match plan (minor) | §8 + Phase 0 add arctic/vitest/pool-workers + test script. |
| 18 | OpenNext caching underspecified (minor) | §13 added; **note: `open-next.config.ts` already exists** (Codex said it did not). |
| 19 | Slug contradicts data (minor) | §1 slugs stored without leading slash; `/l/` is routing-only; legacy `'/yhk'` normalized. |
| 20 | — | Verdict tracked; aiming for ready-with-changes next round. |

**v3 (after Codex adversarial round 2 — verdict was ready-with-changes; both round-1 pushbacks confirmed):**

| # | Finding (sev) | Resolution |
| --- | --- | --- |
| 1 | `/internal/*` CSRF rule contradicts shared-dev (blocker) | Global Constraints + §3.3 + §4.5: `/api/*` uses `assertSameOrigin`; `/internal/*` is cross-origin (bearer + `DEPLOY_ENV=dev` 404 guard + CORS allowlist, no cookie auth). |
| 2 | Prod still ships `/internal/*` code (major) | §3.3: every `/internal/*` returns 404 unless `DEPLOY_ENV==='dev'`; `env.ts` rejects shared-dev config on prod. |
| 3 | Token→actor audit ambiguity (major) | §6 `audit_logs` adds `actor_context` + `shared_token_hash` + `shared_token_label`. |
| 4 | Survey join key defeats anonymity (major) | §6: token-hash only on `survey_assignments`; `survey_responses` carry only `survey_id`; conditional-update gate for one-submit. |
| 5 | Local better-sqlite has no migration runner (major) | §2.2: `drizzle-orm/better-sqlite3` migrator over the same `drizzle/migrations`; new `db:migrate:local:sqlite`; retire hand-created `users`. |
| 6 | Internal storage proxy missing (major) | §3.3: add `/internal/uploads` to the contract (token→actor authz, server keys, limits, dev guard). |
| 7 | FK choreography too vague (major) | §2.2: raw Wrangler migration SQL with `PRAGMA defer_foreign_keys=ON` first; not runtime `batch()`; tested on remote copy. |
| 8 | Redirect blocked by stats write (minor) | §6: `/l/[slug]` 302s first, records stats via `ctx.waitUntil`, fail-open. |
| 9 | `member_feed_state` can't track events (minor) | §6: add `events_seen_at`. |
| — | User decision: **Auth.js** for auth | §4 fully rewritten to Auth.js v5 + `@auth/drizzle-adapter` (DB sessions, Google), replacing the Arctic + custom-session design. Email-takeover concern now covered by Auth.js defaults (no dangerous email linking). |
| — | User question: shared dev Worker ops | New §15 added (shared Worker lifecycle + when to redeploy + AGENTS/README/CLAUDE doc deliverable). |
| — | User directive: use shadcn/ui | Global Constraints now require building UI from the shadcn/ui local registry (`pnpm dlx shadcn@latest add …`) wherever one fits; bespoke only when no shadcn equivalent. Applies to every UI phase (2-9). |
| — | User directive: use Tailwind CSS | Global Constraints now require Tailwind CSS v4 (already configured) for all styling, bound to `globals.css` tokens; no CSS-in-JS / ad-hoc global CSS. Applies to every UI phase. |

**Phase 0 review (Codex implementation, accepted with follow-ups):** foundations green (typecheck/lint/test/migrate/seed). Follow-ups folded into the Phase 1 handoff: (1) wire `@cloudflare/vitest-pool-workers` D1 harness; (2) add a members repo D1 integration test + a shared-mode parity test; (3) implement the `/internal/*` per-domain routes the §3.3 contract describes.

**v4 (after Codex adversarial round 3 — verdict ready-with-changes; round-2 fixes confirmed correct):**

| # | Finding (sev) | Resolution |
| --- | --- | --- |
| 1 | Adapter eagerly touches bindings (major) | §4.1 lazy `NextAuth(async req => …)` + lazy `getDb()`; `getActor()` dynamically imports `auth()` (§4.6). |
| 2 | Extended members breaks adapter (major) | §6 all CODE columns nullable/defaulted; `email_verified` timestamp_ms; adapter `createUser` inserts only auth fields. |
| 3 | Base role via event fragile (major) | §4.2/§5 base `member` is implicit; `member_roles` stores only elevated scopes. |
| 4 | No-email-linking vs pre-created members (major) | §4.2 v1 members self-provision on first sign-in; admins never create login rows by email; invite flow deferred. |
| 5 | Stale auth route map (minor) | §1 now `/api/auth/[...nextauth]`. |
| 6 | `ctx.waitUntil` vs adapters-only rule (minor) | Global Constraints + §6 add `runInBackground()` helper from `src/server/cloudflare.ts`. |
| 7 | §15 triggers miss auth/env/runtime (minor) | §15 adds triggers 6-8 (auth.ts, env.ts, wrangler.jsonc, storage proxy, deps). |
| 8 | Docs-only shared guard weak (minor) | §15 moves a CI/PR guard into Phase 0. |

**Open for round 4 (convergence pass):** with all blockers/majors resolved across 3 rounds, confirm whether the plan is now **ready**. Remaining genuinely-open items are deliberately pushed to implementation spikes, not plan gaps: (a) the middleware-vs-D1 result (Phase 0 spike); (b) clean-reset vs additive `users→members` (decided by the Phase 0 D1 inventory). Flag anything still blocking implementation.

**Phase 0/1 implementation (accepted, ahead of v5):** Phase 0 foundations and most of Phase 1 (auth, RBAC skeleton, hardened uploads) were built against v4 before the v5 revision below — see `git log` (`ebf1a7d` through `a5acaeb`). None of the v5-affected subsystems (content/publishing, library, events list, announcements, tours, points) had been built yet, so v5 is a clean scope change rather than a rework of shipped code. The only Phase-1 follow-up v5 adds is the roster-gate check (§4.2, §12 Phase 1).

**v5 (user-driven scope revision after a stakeholder/boss meeting, before Phase 2+ implementation; decided via one-at-a-time clarifying questions, all confirmed):**

| # | Decision | Resolution |
| --- | --- | --- |
| 1 | Retention records unify event points + manual non-point entries | §6 `retention_records` replaces `point_awards`; one row per event-derived or manual record; `points` nullable AND signable (deductions allowed); `reason` is freeform — no admin-managed catalog/lookup table. |
| 2 | Retention/CRS role renamed | §5 `crs` → `retention` (same people, now also covers manual records). |
| 3 | Events tab repurposed; Calendar is the sole events surface | §1/§6/§12: `/portal/events` (index) removed, tab becomes "My Retention History" (summary + history + term selector); Calendar is the only discovery surface; event detail moves to `/portal/calendar/[eventId]`. |
| 4 | QR/barcode attendance flips to member-carried codes | §6 `crs_attendance`: member holds a static, permanent, client-generated code; event admins pick the event then scan (+ manual search fallback); reachable via the mobile Menu sheet AND the desktop profile page. |
| 5 | Admin reporting + xlsx export, three kinds | §6 "Reporting", §12 Phase 8: per-member full-year history, per-event roster, whole-term master export — all xlsx, all views over `retention_records`. |
| 6 | Per-term member roster becomes the sign-in gate | §4.2, §6 `term_member_roster`: must be on the CURRENT term's roster (in addition to domain/allowlist) to sign in; new terms carry the roster over (admin edits) rather than starting blank; off-roster existing members are locked out (`status='inactive'`) with history preserved. Points/retention already reset to 0 per term with no extra logic needed, since records are queried by `term_id`. |
| 7 | Admin-pinned nav links, new | §6 `nav_pins`, §1: label+URL(+icon), visible to everyone, no per-role scoping v1; on mobile they live in the Menu sheet, not new bottom-nav icons (minimalism, Global Constraints). |
| 8 | Dashboard Quick Links CMS, new, deliberately separate from nav pins | §6 `quick_links`, §1: replaces the dashboard's old announcements widget; confirmed as a distinct admin-managed list from `nav_pins` despite the similar row shape. |
| 9 | Short-link embed/OG preview control, new | §6 `short_links.preview_*` columns, §7: owner sets title/description/image; `/l/[slug]` branches on crawler UA to serve OG meta tags instead of an immediate redirect to bots, while real users still get the instant 302. |
| 10 | Content/publishing system (public + member library) deferred | §11 #1, §1, §6, §12: cut entirely for v1, including the public `/articles` site, not just the member Library. `/` becomes a simple static landing page. The existing library-graph-search deferral nests inside this larger one. |
| 11 | Announcements subsystem deferred | §11 #2, §6, §12: admin CRUD, the page, the dashboard widget (replaced by #8), and the calendar/notification slices that depended on it. |
| 12 | Guided tours deferred, columns dropped now | §11 #3, §6: `tour_member_done`/`tour_admin_done` dropped from `members` rather than left unused, since no real member data exists yet. |
| 13 | Notification settings page removed, feed/bell kept | §11 #4: no preference data exists to configure; the materialized/derived notification feed itself is unaffected. |
| 14 | Survey auto-trigger-on-event-close removed | §11 #5: surveys stay a fully manual admin feature, including event-linked ones; only the automation is cut. |
| 15 | Portal search bar removed | §1: no search UI in v1 portal nav. |
| 16 | Duplicate top-right profile/account icon removed | §1: confirmed to be a duplicate of the bottom-left profile entry, not notifications — nothing needs a new home. |
| 17 | Minimalism is a cross-cutting constraint, not a deliverable | Global Constraints: fixed-size mobile bottom nav (~4-5 slots) forever; new v5 admin surfaces (pins, member card) live in the Menu sheet, not as new top-level chrome. |
| 18 | Phases renumbered 0-9 (was 0-10) | §12: ex-Phase 2 (public site) and ex-Phase 4 (library) removed; roster-gate folds into Phase 1; QR/barcode folds into the CRS-events phase; reporting/nav-pins/quick-links/roster-admin fold into the admin phase; hardening is now the last phase (was Phase 10, now Phase 9 — §15's "left to Phase 10" reference below means Phase 9 post-v5). |

---

## 15. Shared Dev Worker Lifecycle & Ops Docs

The `shared` access mode is backed by the **deployed dev Worker** (`code-nest-dev`, `DEPLOY_ENV=dev`), which owns `code-nest-dev-db` + `code-nest-dev-uploads` and hosts the `/internal/*` API. Outside developers run the app locally with `APP_ENV=shared` and depend on that Worker being current. This creates explicit redeploy obligations.

**When the dev Worker MUST be redeployed (and dev D1 migrated/seeded):**
1. Any change to `src/db/schema.ts` / `drizzle/migrations` → run `db:migrate:dev` then `deploy:dev`. Stale schema breaks every shared client.
2. Any change to the internal API contract (`src/db/contract/*`, `src/app/internal/*`) or repository signatures used over the proxy → `deploy:dev`.
3. Any change to `permissions.ts`, the shared `actor` resolution, or `shared_dev_tokens` mapping → `deploy:dev` (+ reseed dev tokens if changed).
4. Seed/demo-data changes outside devs rely on → `db:seed:dev`.
5. Auth.js config changes that affect the dev Worker's own sign-in (real OAuth on dev) → `deploy:dev` + ensure dev secrets set.
6. Changes to `src/auth.ts`, `src/server/env.ts`, or `wrangler.jsonc` env/bindings → `deploy:dev` (+ set/rotate dev secrets as needed).
7. Changes to the storage proxy (`/internal/uploads`, `src/storage/adapters/shared-api.ts`) → `deploy:dev`.
8. Dependency/runtime upgrades affecting the dev Worker (Auth.js, drizzle adapter, OpenNext) → `deploy:dev`.

**Token + secret ops:** rotating `SHARED_API_TOKEN` requires updating the dev Worker secret (`wrangler secret put`), updating the `shared_dev_tokens` seed, and reissuing `.env.local` to outside devs. Documented in `docs/operations/secrets-and-env.md`.

**Documentation deliverable (Phase 0 + ongoing):** capture the above in:
- `AGENTS.md` — a "Shared dev Worker" section: what it is, and the redeploy/migrate triggers list above, so any agent that touches schema/contract/permissions knows to `db:migrate:dev` + `deploy:dev`.
- `README.md` — a short "Shared dev backend" subsection pointing at the dev Worker and the redeploy rule, plus the `APP_ENV=shared` onboarding pointer.
- `CLAUDE.md` (create a project-level one) — a concise rule: "After changing schema, migrations, the internal contract, permissions, or auth config, redeploy the dev Worker (`db:migrate:dev` + `deploy:dev`) or shared-mode developers break."
- **Phase 0 CI/PR guard:** a lightweight check that flags when `src/db/schema.ts`, `drizzle/migrations/**`, `src/db/contract/**`, `src/app/internal/**`, `src/server/auth/permissions.ts`, or `src/auth.ts` change without a shared-dev deploy note — docs alone are the kind of rule agents miss, so this is automated rather than left to Phase 9 (v5 renumbering — was Phase 10).
- `docs/setup/shared-dev-onboarding.md` + `docs/operations/migrations.md` — expand with the lifecycle + token rotation.

> Note: these doc edits are part of the build (Phase 0 deliverable), not done in this planning pass. They are listed here so the obligation is explicit and reviewable.

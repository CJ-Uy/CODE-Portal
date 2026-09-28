# Phase 9 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the CODE Portal for launch by adding request rate limits to the abuse-prone routes, running a documented security review against the master plan's §10 checklist, adding a light Playwright E2E suite that exercises one happy path per prior phase, doing the OpenNext caching pass (§13), refreshing the docs, and verifying the shared-dev onboarding path plus wiring the existing shared-dev guard into real CI.

**Architecture:** Phase 9 is the final phase (master plan §12) and is a cross-cutting hardening pass, not a feature build. It touches the auth route, the short-link and scan handlers, `open-next.config.ts`, the docs tree, and adds a new top-level `e2e/` Playwright project plus a new `src/server/ratelimit/` module. Rate limiting uses a D1-backed fixed-window counter (no new infra, respects the §3.4 D1 budget) behind a small interface a KV or Durable-Object limiter can replace later. The E2E suite drives a locally running app (`APP_ENV=local`, better-sqlite3, seeded demo data) with mocked Google OAuth, so it needs zero Cloudflare credentials.

**Tech Stack:** Playwright (`@playwright/test`), Next.js 16 dev server (`next dev`), better-sqlite3 local DB + the existing seed module, Drizzle ORM (D1/SQLite) for the rate-limit counter table, Vitest + `@cloudflare/vitest-pool-workers` (existing `vitest.config.mts`) for rate-limit unit/integration tests, OpenNext (`@opennextjs/cloudflare`) for the caching pass.

## Global Constraints

- This is the LAST phase. It E2E-tests features delivered in Phases 1 through 8, so it can be DRAFTED now but MUST be SEQUENCED and EXECUTED only after Phases 2-8 are merged. Each E2E scenario below names the phase whose UI/route it depends on; if that phase's deliverable is not yet on the branch, that scenario's test will fail for a real (not flaky) reason. See "Sequencing & Dependency Gate" directly below this list. (master plan §8 E2E line, §12 Phase 9)
- Drizzle schema at `src/db/schema.ts` is the ONE source of truth; one migration set under `drizzle/migrations`. The rate-limit counter table (Task 1) is a schema change and goes through `pnpm db:generate` like any other. (master plan Global Constraints, CLAUDE.md)
- No raw SQL internal endpoints; D1 is never exposed as `DATABASE_URL`. (CLAUDE.md)
- Show the exact `pnpm exec wrangler` / `pnpm db:*` command and wait for approval before any D1 reset, migration, seed, delete, or production-touching operation. This gates Task 1's migration-apply step and the Task 9 dev-Worker redeploy. Do not run those non-interactively. (CLAUDE.md)
- After this work changes `src/db/schema.ts`, `drizzle/migrations`, or auth config, the dev Worker must be redeployed (`pnpm db:migrate:dev` then `pnpm deploy:dev`) and the shared-dev guard (`pnpm check:shared-dev-note`) requires a deploy note — surfaced as the final, approval-gated Task 9. (CLAUDE.md, master plan §15)
- Mutating `/api/*` handlers stay cookie-authenticated, same-origin (`assertSameOrigin`); `/internal/*` stays bearer + `DEPLOY_ENV=dev` guarded. Rate limiting is ADDED IN FRONT of these checks, never as a replacement. (master plan §3.3, §4.5)
- Every privileged mutation stays authorization-checked in the repository via `permissions.can()` and audited via `audit.record()`. Rate limiting is a separate, earlier gate and does not touch authz. (master plan §5, §10)
- No realtime infra in v1. The rate limiter is a request/response D1 counter, not a streaming or DO-backed limiter. (master plan §3.4 "no per-request query storms", §11 #6)
- Brand + copy rules apply to any UI/error copy and all docs: headings Unna, body Source Sans; no em dashes in UI copy, code comments, docs, or commits; plain product language; no AI-stock phrasing. (master plan Global Constraints)
- `roster:manage` and `nav:configure` live under the `member_admin` scope; the retention/event/points scope is `retention` (renamed from `crs`). Use these exact strings in any E2E role-assignment assertion. (v5 foundation plan Global Constraints, master plan §5)

---

## Sequencing & Dependency Gate

Phase 9 is necessarily last because its E2E suite (Task 4 onward) drives features built in earlier phases. This plan is written now so the hardening contract is reviewable, but the executor MUST confirm the following are merged before running the E2E tasks. Each row maps a Phase 9 E2E scenario (from master plan §8: "sign-in (mocked OAuth), create link, RSVP + simulated scan, log a manual retention record, assign role") to the phase that must ship it first.

| E2E scenario (master plan §8) | Depends on phase | Concrete deliverable that must exist |
| --- | --- | --- |
| Sign in (mocked OAuth) | Phase 1 (built) | `/signin` page + Auth.js Google flow + `/portal` layout gate. Already on the branch (`git log`). |
| Create link | Phase 3 | Short-link CRUD UI + `/l/[slug]` redirect. |
| RSVP + simulated scan | Phase 4 | CRS event detail (`/portal/calendar/[eventId]`) RSVP control + member QR/barcode + event-admin scan flow. |
| Log a manual retention record | Phase 5 | Admin manual-retention UI (member checklist + term/event picker + freeform reason + points). |
| Assign role | Phase 8 | Admin roles-management screen (`/portal/admin/roles`). |

**Tasks that DO NOT depend on later phases and can be executed at any time** (they only touch already-built auth/upload routes, config, docs, and CI): Task 1 (rate-limit core), Task 2 (rate-limit the auth route), Task 3 (rate-limit link-create + scan handlers — wire the limiter, mark the handler-binding step as blocked on Phase 3/4 if those handlers do not yet exist), Task 6 (OpenNext caching pass), Task 7 (security review), Task 8 (docs refresh), Task 9 (CI guard + onboarding verification + redeploy).

**Executor rule:** Run `git log --oneline` and confirm Phases 2-8 plans are merged. If any are not, execute only the independent tasks above and STOP before the blocked E2E scenarios rather than writing tests against routes that do not exist. Do not stub the missing UI to make a test pass.

---

### Task 1: Rate-limit core — D1 fixed-window counter + interface

**Files:**
- Modify: `src/db/schema.ts` (add the `rate_limit_counters` table)
- Create: `src/server/ratelimit/limiter.ts`
- Create: `src/server/ratelimit/limiter.integration.test.ts`
- Generate: `drizzle/migrations/<n>_<name>.sql` (drizzle-kit names it; applied in Task 1 Step 9)

**Interfaces:**
- Consumes: `getDb()` from `@/db/client` (returns the lazy Drizzle handle), the existing `nowMs` default and `sqliteTable`/`text`/`integer`/`index`/`primaryKey` helpers already imported in `src/db/schema.ts`.
- Produces: `rateLimitCounters` table export; `checkRateLimit(db, { key, limit, windowMs, now? }): Promise<RateLimitResult>` where `RateLimitResult = { allowed: boolean; remaining: number; resetAt: number }`. Tasks 2 and 3 import `checkRateLimit` and the `RateLimitResult` type. `key` is a caller-built string like `auth:signin:<ip>` or `link:create:<memberId>`.

- [ ] **Step 1: Add the counter table to the schema**

In `src/db/schema.ts`, add this table at the end of the file (after the last existing table, before the final newline). It uses the helpers already imported at the top of the file:

```ts
export const rateLimitCounters = sqliteTable(
	"rate_limit_counters",
	{
		bucketKey: text("bucket_key").notNull(),
		windowStart: integer("window_start", { mode: "timestamp_ms" }).notNull(),
		count: integer("count").notNull().default(0),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		primaryKey({ columns: [table.bucketKey, table.windowStart] }),
		index("rate_limit_counters_window_start_idx").on(table.windowStart),
	],
);
```

- [ ] **Step 2: Write the failing integration test**

Create `src/server/ratelimit/limiter.integration.test.ts`:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { checkRateLimit } from "./limiter";

const WINDOW_MS = 60_000;
const NOW = new Date("2026-06-19T00:00:00.000Z").getTime();

describe("checkRateLimit", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM rate_limit_counters").run();
	});

	it("allows requests up to the limit within one window", async () => {
		const db = drizzle(env.DB, { schema });
		const opts = { key: "auth:signin:1.2.3.4", limit: 3, windowMs: WINDOW_MS, now: NOW };

		const first = await checkRateLimit(db, opts);
		const second = await checkRateLimit(db, opts);
		const third = await checkRateLimit(db, opts);

		expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, true]);
		expect(third.remaining).toBe(0);
	});

	it("blocks the request that exceeds the limit", async () => {
		const db = drizzle(env.DB, { schema });
		const opts = { key: "auth:signin:1.2.3.4", limit: 2, windowMs: WINDOW_MS, now: NOW };

		await checkRateLimit(db, opts);
		await checkRateLimit(db, opts);
		const blocked = await checkRateLimit(db, opts);

		expect(blocked.allowed).toBe(false);
		expect(blocked.remaining).toBe(0);
		expect(blocked.resetAt).toBe(NOW + WINDOW_MS);
	});

	it("resets the count in a new window", async () => {
		const db = drizzle(env.DB, { schema });
		const base = { key: "link:create:mem_1", limit: 1, windowMs: WINDOW_MS };

		const firstWindow = await checkRateLimit(db, { ...base, now: NOW });
		const blocked = await checkRateLimit(db, { ...base, now: NOW + 1 });
		const nextWindow = await checkRateLimit(db, { ...base, now: NOW + WINDOW_MS });

		expect(firstWindow.allowed).toBe(true);
		expect(blocked.allowed).toBe(false);
		expect(nextWindow.allowed).toBe(true);
	});

	it("isolates counts per key", async () => {
		const db = drizzle(env.DB, { schema });
		const base = { limit: 1, windowMs: WINDOW_MS, now: NOW };

		const a = await checkRateLimit(db, { ...base, key: "scan:submit:mem_a" });
		const b = await checkRateLimit(db, { ...base, key: "scan:submit:mem_b" });

		expect(a.allowed).toBe(true);
		expect(b.allowed).toBe(true);
	});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- limiter.integration.test.ts`
Expected: FAIL — `./limiter` does not exist yet (module-not-found).

- [ ] **Step 4: Write `src/server/ratelimit/limiter.ts`**

```ts
import { and, eq, sql } from "drizzle-orm";
import { rateLimitCounters } from "@/db/schema";
import type { getDb } from "@/db/client";

type Db = ReturnType<typeof getDb>;

export type RateLimitResult = {
	allowed: boolean;
	remaining: number;
	resetAt: number;
};

export type RateLimitOptions = {
	key: string;
	limit: number;
	windowMs: number;
	now?: number;
};

/**
 * Fixed-window counter backed by D1. One upsert per request: a single bound
 * statement, well within the §3.4 budget. The window is derived from the
 * request time so concurrent requests in the same window converge on one row.
 * Fail-open is the caller's choice; this function throws only on a real DB
 * error, which the auth/link/scan callers translate into a permissive result.
 */
export async function checkRateLimit(db: Db, options: RateLimitOptions): Promise<RateLimitResult> {
	const now = options.now ?? Date.now();
	const windowStart = now - (now % options.windowMs);
	const resetAt = windowStart + options.windowMs;
	const windowStartDate = new Date(windowStart);

	await db
		.insert(rateLimitCounters)
		.values({ bucketKey: options.key, windowStart: windowStartDate, count: 1, updatedAt: new Date(now) })
		.onConflictDoUpdate({
			target: [rateLimitCounters.bucketKey, rateLimitCounters.windowStart],
			set: { count: sql`${rateLimitCounters.count} + 1`, updatedAt: new Date(now) },
		});

	const [row] = await db
		.select({ count: rateLimitCounters.count })
		.from(rateLimitCounters)
		.where(and(eq(rateLimitCounters.bucketKey, options.key), eq(rateLimitCounters.windowStart, windowStartDate)))
		.limit(1);

	const count = row?.count ?? 1;
	const remaining = Math.max(0, options.limit - count);
	return { allowed: count <= options.limit, remaining, resetAt };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- limiter.integration.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Generate the migration (writes a SQL file, no D1 touched yet)**

Run: `pnpm db:generate`
Expected: drizzle-kit prints a new migration file path and lists exactly one change: create table `rate_limit_counters` with its composite primary key and `rate_limit_counters_window_start_idx` index. If it lists any OTHER change, stop — the schema drifted and that drift must be reconciled before continuing.

- [ ] **Step 8: STOP — show the exact local apply command and wait for approval**

Per CLAUDE.md, do not run a D1 migration without explicit approval. Present this command and wait:
```bash
pnpm db:migrate:local:sqlite
```
This applies the new migration to the local better-sqlite3 DB only. It does not touch dev or prod D1.

- [ ] **Step 9: After approval, apply locally and re-run the suite**

Run: `pnpm db:migrate:local:sqlite`
Then run: `pnpm test`
Expected: both succeed; the full suite stays green (the vitest pool auto-applies `drizzle/migrations` to its own ephemeral D1, so the new table is present there too).

- [ ] **Step 10: Commit**

```bash
git add src/db/schema.ts src/server/ratelimit/limiter.ts src/server/ratelimit/limiter.integration.test.ts drizzle/migrations
git commit -m "feat(ratelimit): add D1 fixed-window rate-limit counter

Adds rate_limit_counters table and checkRateLimit() for the auth,
link-create, and scan-submit routes hardened in Phase 9."
```

---

### Task 2: Rate-limit the auth routes

**Files:**
- Create: `src/server/ratelimit/policies.ts`
- Create: `src/server/ratelimit/policies.test.ts`
- Modify: `src/app/api/auth/[...nextauth]/route.ts` (wrap the exported `POST`)

**Interfaces:**
- Consumes: `checkRateLimit` and `RateLimitResult` from `./limiter` (Task 1); `getDb` from `@/db/client`; the Auth.js `handlers` re-exported by the existing route file.
- Produces: `clientIpFromRequest(request): string`, `RATE_LIMITS` (a record of named policies with `limit`/`windowMs`), and `tooManyRequests(result): Response` (a 429 with a `Retry-After` header). Task 3 imports all three.

- [ ] **Step 1: Write the failing unit test for the helpers**

Create `src/server/ratelimit/policies.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clientIpFromRequest, RATE_LIMITS, tooManyRequests } from "./policies";

function req(headers: Record<string, string>): Request {
	return new Request("https://portal.example.com/api/auth/signin/google", { method: "POST", headers });
}

describe("clientIpFromRequest", () => {
	it("prefers cf-connecting-ip", () => {
		expect(clientIpFromRequest(req({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }))).toBe("9.9.9.9");
	});

	it("falls back to the first x-forwarded-for hop", () => {
		expect(clientIpFromRequest(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
	});

	it("returns a stable sentinel when no ip header is present", () => {
		expect(clientIpFromRequest(req({}))).toBe("unknown");
	});
});

describe("RATE_LIMITS", () => {
	it("defines the three hardened policies", () => {
		expect(RATE_LIMITS.authSignin.limit).toBeGreaterThan(0);
		expect(RATE_LIMITS.linkCreate.limit).toBeGreaterThan(0);
		expect(RATE_LIMITS.scanSubmit.limit).toBeGreaterThan(0);
	});
});

describe("tooManyRequests", () => {
	it("returns a 429 with a Retry-After header", () => {
		const now = Date.now();
		const res = tooManyRequests({ allowed: false, remaining: 0, resetAt: now + 30_000 });
		expect(res.status).toBe(429);
		expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- policies.test.ts`
Expected: FAIL — `./policies` does not exist yet.

- [ ] **Step 3: Write `src/server/ratelimit/policies.ts`**

```ts
import type { RateLimitResult } from "./limiter";

export const RATE_LIMITS = {
	authSignin: { limit: 10, windowMs: 60_000 },
	linkCreate: { limit: 20, windowMs: 60_000 },
	scanSubmit: { limit: 120, windowMs: 60_000 },
} as const;

export function clientIpFromRequest(request: Request): string {
	const cfIp = request.headers.get("cf-connecting-ip");
	if (cfIp) return cfIp.trim();
	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded) {
		const first = forwarded.split(",")[0]?.trim();
		if (first) return first;
	}
	return "unknown";
}

export function tooManyRequests(result: RateLimitResult): Response {
	const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
	return new Response(JSON.stringify({ error: "Too many requests. Please try again shortly." }), {
		status: 429,
		headers: {
			"content-type": "application/json",
			"retry-after": String(retryAfterSeconds),
		},
	});
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- policies.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Wrap the auth POST handler with the limiter**

Open `src/app/api/auth/[...nextauth]/route.ts`. It currently re-exports the Auth.js handlers, of the shape `export const { GET, POST } = handlers;`. Replace that single export line so `GET` passes through unchanged and `POST` is rate-limited by client IP before delegating to Auth.js:

```ts
import { handlers } from "@/auth";
import { getDb } from "@/db/client";
import { checkRateLimit } from "@/server/ratelimit/limiter";
import { clientIpFromRequest, RATE_LIMITS, tooManyRequests } from "@/server/ratelimit/policies";

export const GET = handlers.GET;

export async function POST(request: Request): Promise<Response> {
	const ip = clientIpFromRequest(request);
	try {
		const result = await checkRateLimit(getDb(), { key: `auth:signin:${ip}`, ...RATE_LIMITS.authSignin });
		if (!result.allowed) return tooManyRequests(result);
	} catch {
		// Fail open: a limiter DB error must never take down sign-in.
	}
	return handlers.POST(request);
}
```

If the existing file already imports `handlers` differently (for example a default import or a re-export through a barrel), keep its import style and only change the export shape to the `GET` passthrough + wrapped `POST` above.

- [ ] **Step 6: Typecheck and run the suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. No existing auth test regresses (the wrapper only adds a pre-check and falls open on error).

- [ ] **Step 7: Commit**

```bash
git add src/server/ratelimit/policies.ts src/server/ratelimit/policies.test.ts "src/app/api/auth/[...nextauth]/route.ts"
git commit -m "feat(ratelimit): rate-limit the auth POST route by client ip

Fail-open per-ip fixed window in front of the Auth.js POST handler so
a limiter DB error can never block sign-in."
```

---

### Task 3: Rate-limit link creation and scan submission

**Files:**
- Create: `src/server/ratelimit/guard.ts`
- Create: `src/server/ratelimit/guard.test.ts`
- Modify: the link-create handler (Phase 3) and the scan-submit handler (Phase 4) — exact paths confirmed at execution time (see Step 5)

**Interfaces:**
- Consumes: `checkRateLimit` from `./limiter` (Task 1); `RATE_LIMITS`, `clientIpFromRequest`, `tooManyRequests` from `./policies` (Task 2); the resolved actor (`{ memberId }`) the handlers already obtain via `getActor()`.
- Produces: `enforceRateLimit(db, policyKey, subject, policy): Promise<Response | null>` — returns a 429 `Response` when blocked, or `null` when the caller should proceed. Link-create and scan-submit handlers call it right after they resolve the actor and before any write.

- [ ] **Step 1: Write the failing unit test**

Create `src/server/ratelimit/guard.test.ts`. It uses a fake db whose `checkRateLimit` is stubbed through a tiny seam so the guard logic is tested without D1:

```ts
import { describe, expect, it, vi } from "vitest";
import * as limiter from "./limiter";
import { enforceRateLimit } from "./guard";
import { RATE_LIMITS } from "./policies";

const fakeDb = {} as Parameters<typeof enforceRateLimit>[0];

describe("enforceRateLimit", () => {
	it("returns null when the limiter allows the request", async () => {
		vi.spyOn(limiter, "checkRateLimit").mockResolvedValue({ allowed: true, remaining: 5, resetAt: Date.now() + 1000 });
		const result = await enforceRateLimit(fakeDb, "link:create", "mem_1", RATE_LIMITS.linkCreate);
		expect(result).toBeNull();
	});

	it("returns a 429 response when the limiter blocks the request", async () => {
		vi.spyOn(limiter, "checkRateLimit").mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 1000 });
		const result = await enforceRateLimit(fakeDb, "link:create", "mem_1", RATE_LIMITS.linkCreate);
		expect(result?.status).toBe(429);
	});

	it("fails open and returns null when the limiter throws", async () => {
		vi.spyOn(limiter, "checkRateLimit").mockRejectedValue(new Error("d1 down"));
		const result = await enforceRateLimit(fakeDb, "scan:submit", "mem_1", RATE_LIMITS.scanSubmit);
		expect(result).toBeNull();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- guard.test.ts`
Expected: FAIL — `./guard` does not exist yet.

- [ ] **Step 3: Write `src/server/ratelimit/guard.ts`**

```ts
import { checkRateLimit } from "./limiter";
import { tooManyRequests } from "./policies";
import type { getDb } from "@/db/client";

type Db = ReturnType<typeof getDb>;
type Policy = { limit: number; windowMs: number };

/**
 * Builds the bucket key as `${policyKey}:${subject}` (subject is usually the
 * memberId, sometimes the client ip) and returns a 429 Response when blocked,
 * or null when the caller should proceed. Fails open: a limiter DB error
 * returns null so a hardening control can never take down a core mutation.
 */
export async function enforceRateLimit(db: Db, policyKey: string, subject: string, policy: Policy): Promise<Response | null> {
	try {
		const result = await checkRateLimit(db, { key: `${policyKey}:${subject}`, limit: policy.limit, windowMs: policy.windowMs });
		return result.allowed ? null : tooManyRequests(result);
	} catch {
		return null;
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- guard.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Wire the guard into the link-create and scan-submit handlers**

This step depends on Phase 3 (links) and Phase 4 (scan) being merged. Locate the handlers first:
```bash
graphify query "short link create handler, link CRUD route, owner member id"
graphify query "attendance scan submit handler, crs_attendance, scanned_by"
```
Then, in each handler, immediately after the actor is resolved (`const actor = await getActor(...)`) and before any DB write, add the guard. For link creation, key on the owner member id:
```ts
const limited = await enforceRateLimit(getDb(), "link:create", actor.memberId, RATE_LIMITS.linkCreate);
if (limited) return limited;
```
For scan submission, key on the scanning admin's member id:
```ts
const limited = await enforceRateLimit(getDb(), "scan:submit", actor.memberId, RATE_LIMITS.scanSubmit);
if (limited) return limited;
```
Add the imports to each handler:
```ts
import { getDb } from "@/db/client";
import { enforceRateLimit } from "@/server/ratelimit/guard";
import { RATE_LIMITS } from "@/server/ratelimit/policies";
```

If Phases 3/4 are NOT yet merged (no link-create or scan handler exists), STOP here and leave Steps 1-4 committed; the guard module is complete and the binding is a one-line addition each phase's own handler will make. Note this in the task handoff rather than creating placeholder handlers.

- [ ] **Step 6: Typecheck and run the suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/ratelimit/guard.ts src/server/ratelimit/guard.test.ts
git commit -m "feat(ratelimit): add per-actor guard for link create and scan submit"
```

(If Step 5 bound the guard into real handlers, `git add` those files in this commit too.)

---

### Task 4: Playwright harness + mocked-OAuth sign-in E2E (Phase 1)

**Files:**
- Modify: `package.json` (add `@playwright/test` devDependency + `test:e2e` script)
- Create: `playwright.config.ts`
- Create: `e2e/fixtures/auth.ts`
- Create: `e2e/signin.spec.ts`
- Create: `e2e/README.md`

**Interfaces:**
- Consumes: the seeded local DB (demo admin `admin@example.com` / demo member `member@example.com` from `src/db/seed/data.ts`), the `/signin` page and `/portal` gate (Phase 1, already built).
- Produces: a runnable `pnpm test:e2e` that boots `next dev` with `APP_ENV=local`, and `signInAs(page, role)` fixture used by Tasks 5. The mocked-OAuth approach (see Step 3) is the single technique every later E2E reuses.

- [ ] **Step 1: Add Playwright and the E2E script**

Run: `pnpm add -D @playwright/test` then `pnpm exec playwright install chromium`.
Then add to `package.json` `scripts` (do not remove existing scripts):
```json
"test:e2e": "playwright test"
```
Expected: `@playwright/test` appears in `devDependencies`; chromium downloads.

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
	testDir: "./e2e",
	timeout: 30_000,
	fullyParallel: false,
	workers: 1,
	reporter: [["list"]],
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command: `next dev --port ${PORT}`,
		url: `http://127.0.0.1:${PORT}`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			APP_ENV: "local",
			AUTH_SECRET: "e2e-test-secret-not-for-production",
			AUTH_URL: `http://127.0.0.1:${PORT}`,
			E2E_AUTH_BYPASS: "1",
		},
	},
});
```

- [ ] **Step 3: Write the mocked-OAuth fixture**

Real Google OAuth cannot run headless in CI, so E2E uses an app-level bypass guarded by `E2E_AUTH_BYPASS` (only honored when `APP_ENV=local`, never in `production`/`shared`). The fixture sets a signed dev session for a seeded member by calling a test-only sign-in route. Create `e2e/fixtures/auth.ts`:

```ts
import type { Page } from "@playwright/test";

export type SeededRole = "admin" | "member";

const SEEDED_EMAIL: Record<SeededRole, string> = {
	admin: "admin@example.com",
	member: "member@example.com",
};

/**
 * Signs in as a seeded member without real Google OAuth. Drives the same
 * /signin page but posts to the E2E_AUTH_BYPASS test route, which is only
 * mounted when APP_ENV=local AND E2E_AUTH_BYPASS=1 (asserted server-side).
 * In production/shared this route does not exist, so the bypass is inert.
 */
export async function signInAs(page: Page, role: SeededRole): Promise<void> {
	const response = await page.request.post("/api/auth/e2e", { data: { email: SEEDED_EMAIL[role] } });
	if (!response.ok()) throw new Error(`E2E sign-in failed: ${response.status()} ${await response.text()}`);
	await page.goto("/portal");
}
```

This fixture needs a test-only route `src/app/api/auth/e2e/route.ts`. Add it now:
```ts
import { getDb } from "@/db/client";
import { members, sessions } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(request: Request): Promise<Response> {
	if (process.env.APP_ENV !== "local" || process.env.E2E_AUTH_BYPASS !== "1") {
		return new Response("Not found", { status: 404 });
	}
	const { email } = (await request.json()) as { email?: string };
	if (!email) return new Response("email required", { status: 400 });

	const db = getDb();
	const [member] = await db.select({ id: members.id }).from(members).where(eq(members.email, email)).limit(1);
	if (!member) return new Response("seeded member not found", { status: 404 });

	const token = `e2e-${crypto.randomUUID()}`;
	const expires = new Date(Date.now() + 1000 * 60 * 60);
	await db.insert(sessions).values({ sessionToken: token, userId: member.id, expires });

	const headers = new Headers({ "content-type": "application/json" });
	headers.append("set-cookie", `authjs.session-token=${token}; Path=/; HttpOnly; SameSite=Lax`);
	return new Response(JSON.stringify({ ok: true }), { headers });
}
```
Confirm the session cookie name with `graphify query "auth.js session cookie name, sessions table, database session strategy"` before finalizing; Auth.js v5 uses `authjs.session-token` over http and `__Secure-authjs.session-token` over https, and the route is hit over http (127.0.0.1) in E2E, so the non-secure name is correct here.

- [ ] **Step 4: Write the sign-in spec**

Create `e2e/signin.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test("a seeded member can reach the portal via mocked sign-in", async ({ page }) => {
	await page.goto("/signin");
	await expect(page).toHaveURL(/\/signin/);

	await signInAs(page, "member");

	await expect(page).toHaveURL(/\/portal/);
	await expect(page.getByRole("main")).toBeVisible();
});

test("an unauthenticated visit to /portal redirects to sign-in", async ({ page }) => {
	await page.goto("/portal");
	await expect(page).toHaveURL(/\/signin/);
});
```

- [ ] **Step 5: Seed the local DB, then run the E2E suite**

Per CLAUDE.md, show and get approval for the seed command first:
```bash
pnpm db:migrate:local:sqlite
pnpm db:seed:local
```
After approval and seeding, run: `pnpm test:e2e -- signin.spec.ts`
Expected: both tests PASS. (If the portal markup differs from `getByRole("main")`, adjust the assertion to a stable visible element on `/portal`; do not weaken it to a bare URL check.)

- [ ] **Step 6: Write `e2e/README.md`**

```md
# E2E tests

Light Playwright suite covering one happy path per shipped phase (master plan
section 8). Runs against `next dev` with `APP_ENV=local` and the seeded
better-sqlite3 DB. No Cloudflare credentials and no real Google OAuth.

## Run

    pnpm db:migrate:local:sqlite
    pnpm db:seed:local
    pnpm test:e2e

## Mocked auth

Sign-in uses `signInAs(page, role)` from `e2e/fixtures/auth.ts`, which posts to
the test-only `/api/auth/e2e` route. That route returns 404 unless
`APP_ENV=local` and `E2E_AUTH_BYPASS=1`, so it is inert in production and shared
mode.
```

- [ ] **Step 7: Commit**

```bash
git add package.json playwright.config.ts e2e/ "src/app/api/auth/e2e/route.ts"
git commit -m "test(e2e): add Playwright harness and mocked-OAuth sign-in test"
```

---

### Task 5: Remaining E2E happy paths (links, RSVP + scan, retention record, assign role)

**Files:**
- Create: `e2e/links.spec.ts` (Phase 3)
- Create: `e2e/event-rsvp-scan.spec.ts` (Phase 4)
- Create: `e2e/retention-record.spec.ts` (Phase 5)
- Create: `e2e/assign-role.spec.ts` (Phase 8)

**Interfaces:**
- Consumes: `signInAs` from `e2e/fixtures/auth.ts` (Task 4); the UI delivered by Phases 3, 4, 5, 8 (see the Sequencing & Dependency Gate table — do not run a spec whose phase is unmerged).
- Produces: the complete §8 E2E scenario list. No code consumes these; they are leaf verification.

**Before writing each spec below, orient with graphify** so the selectors match the real UI, e.g. `graphify query "short link create form, slug input, destination url field"`. Do not invent routes or test ids; read the actual phase deliverable.

- [ ] **Step 1: Links — create a short link (Phase 3)**

Create `e2e/links.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test("a member can create a short link and see it listed", async ({ page }) => {
	await signInAs(page, "member");
	await page.goto("/portal/links");

	const slug = `e2e-${Date.now().toString(36)}`;
	await page.getByRole("button", { name: /new link|create link/i }).click();
	await page.getByLabel(/slug/i).fill(slug);
	await page.getByLabel(/destination|url/i).fill("https://example.com/e2e-target");
	await page.getByRole("button", { name: /save|create/i }).click();

	await expect(page.getByText(slug)).toBeVisible();
});
```

- [ ] **Step 2: Run it**

Run: `pnpm test:e2e -- links.spec.ts`
Expected: PASS once Phase 3 is merged. If the link UI uses different labels, fix the selectors to match the real form (confirm via graphify), not by loosening the assertion.

- [ ] **Step 3: RSVP + simulated scan (Phase 4)**

Create `e2e/event-rsvp-scan.spec.ts`. The seed provides event `evt_demo`. RSVP as the member, then sign in as the admin and record the scan against that member (the v5 flow: admin picks the event and scans/records the member code; the spec uses the manual-search fallback so it needs no camera):
```ts
import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test("member RSVPs and an admin records attendance via the scan fallback", async ({ page }) => {
	await signInAs(page, "member");
	await page.goto("/portal/calendar/evt_demo");
	await page.getByRole("button", { name: /rsvp|going/i }).click();
	await expect(page.getByText(/you are going|rsvp confirmed/i)).toBeVisible();

	await signInAs(page, "admin");
	await page.goto("/portal/admin/events");
	await page.getByRole("link", { name: /consulting practice night/i }).click();
	await page.getByRole("button", { name: /scan|check.?in/i }).click();
	await page.getByPlaceholder(/search.*name|email/i).fill("member@example.com");
	await page.getByRole("button", { name: /record|confirm|check.?in/i }).click();

	await expect(page.getByText(/demo member/i)).toBeVisible();
});
```

- [ ] **Step 4: Run it**

Run: `pnpm test:e2e -- event-rsvp-scan.spec.ts`
Expected: PASS once Phase 4 is merged. Adjust selectors to the real event-detail and scan UI via graphify; keep the two-actor structure (member RSVPs, admin records).

- [ ] **Step 5: Manual retention record (Phase 5)**

Create `e2e/retention-record.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test("an admin logs a manual retention record for a member", async ({ page }) => {
	await signInAs(page, "admin");
	await page.goto("/portal/admin/retention");

	await page.getByLabel(/member/i).first().check();
	await page.getByLabel(/reason/i).fill("Submitted the required medical waiver");
	await page.getByRole("button", { name: /save|log record|submit/i }).click();

	await expect(page.getByText(/medical waiver/i)).toBeVisible();
});
```

- [ ] **Step 6: Run it**

Run: `pnpm test:e2e -- retention-record.spec.ts`
Expected: PASS once Phase 5 is merged. The retention UI is a member checklist + term/event picker + freeform reason + optional points; align the selectors to the real controls via graphify.

- [ ] **Step 7: Assign a role (Phase 8)**

Create `e2e/assign-role.spec.ts`. Use the exact v5 scope strings:
```ts
import { expect, test } from "@playwright/test";
import { signInAs } from "./fixtures/auth";

test("a super admin assigns the link role to a member", async ({ page }) => {
	await signInAs(page, "admin");
	await page.goto("/portal/admin/roles");

	await page.getByRole("row", { name: /demo member/i }).getByRole("button", { name: /assign|edit roles/i }).click();
	await page.getByLabel(/link/i).check();
	await page.getByRole("button", { name: /save/i }).click();

	await expect(page.getByRole("row", { name: /demo member/i })).toContainText(/link/i);
});
```

- [ ] **Step 8: Run it**

Run: `pnpm test:e2e -- assign-role.spec.ts`
Expected: PASS once Phase 8 is merged. Confirm the roles-screen markup via graphify and align selectors; assert against the `link` role label.

- [ ] **Step 9: Run the whole E2E suite**

Run: `pnpm test:e2e`
Expected: all five specs PASS (sign-in from Task 4 plus the four here), assuming Phases 3/4/5/8 are merged.

- [ ] **Step 10: Commit**

```bash
git add e2e/links.spec.ts e2e/event-rsvp-scan.spec.ts e2e/retention-record.spec.ts e2e/assign-role.spec.ts
git commit -m "test(e2e): cover link create, rsvp + scan, retention record, assign role"
```

---

### Task 6: OpenNext caching pass (§13)

**Files:**
- Modify: `open-next.config.ts`
- Modify: `src/app/page.tsx` (add an explicit static render flag if absent)
- Modify: the `/portal` layout/pages and `/l/[slug]` route (add explicit `dynamic` flags — exact paths confirmed via graphify)
- Create: `docs/architecture/caching.md`

**Interfaces:**
- Consumes: nothing in code; this task encodes the §13 decisions as explicit Next.js route segment config so the OpenNext build classifies each route correctly.
- Produces: documented, explicit caching posture: `/` static, everything under `/portal/*` dynamic, `/l/[slug]` dynamic.

- [ ] **Step 1: Orient on the route tree**

Run: `graphify query "page.tsx route segment config, portal layout, dynamic rendering, short link slug route"`
This lists the current `/`, `/portal/*`, and `/l/[slug]` files so the flags below go in the right files. (Phase-2/3 deliverables will have added `/portal/*` and `/l/[slug]`; if `/l/[slug]` is not yet present, skip its sub-step and note it.)

- [ ] **Step 2: Make `/` explicitly static**

In `src/app/page.tsx`, confirm there is no `cookies()`/`headers()`/DB call (the v5 landing page is static). Add at the top of the file, after imports:
```ts
export const dynamic = "force-static";
```
This matches §13: "`/` is now a simple static landing page and can render fully static/ISR with no cache-invalidation concerns".

- [ ] **Step 3: Make `/portal/*` explicitly dynamic**

In the `/portal` layout file (`src/app/portal/layout.tsx` if present, otherwise each `/portal/**/page.tsx` that reads the session), add:
```ts
export const dynamic = "force-dynamic";
```
§13: "everything under `/portal/*` is dynamic". The layout already calls `auth()`/`cookies()`, so this makes the classification explicit rather than relying on inference.

- [ ] **Step 4: Make `/l/[slug]` explicitly dynamic**

In the short-link redirect route (Phase 3; e.g. `src/app/l/[slug]/route.ts`), add:
```ts
export const dynamic = "force-dynamic";
```
§13: "The short-link redirect is dynamic". If Phase 3 is unmerged and the route does not exist, skip this sub-step and record it in the handoff.

- [ ] **Step 5: Decide on the incremental cache override**

In `open-next.config.ts`, keep the R2 incremental cache commented out for v1: with `/` static-at-build and everything dynamic under `/portal/*`, there is no ISR revalidation surface that needs a shared incremental cache, so the default in-Worker cache is sufficient. Leave the file at its documented default but replace the bare comment with a decision note:
```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// v1 caching posture (master plan section 13): `/` is static-at-build,
// `/portal/*` and `/l/[slug]` are force-dynamic, so there is no ISR
// revalidation surface that needs a shared incremental cache. The default
// in-Worker cache is sufficient. Revisit R2 incremental cache only if a
// future phase introduces ISR or on-demand revalidation.
export default defineCloudflareConfig({});
```

- [ ] **Step 6: Build and confirm classification**

Run: `pnpm build`
Expected: the Next build output marks `/` as static (a filled circle / "Static") and `/portal/*` + `/l/[slug]` as dynamic (lambda / "Dynamic"). Read the route table in the build output and confirm it matches §13. If `/` shows as dynamic, find and remove the accidental dynamic API (a `cookies()`/`headers()` call) before continuing.

- [ ] **Step 7: Write `docs/architecture/caching.md`**

```md
# Caching (OpenNext)

v1 posture, per master plan section 13:

- `/` (public landing): static at build (`export const dynamic = "force-static"`).
  No DB, no cookies; content/publishing is deferred so there is nothing to revalidate.
- `/portal/*` (member workspace and admin): dynamic (`force-dynamic`). Every
  request reads the session, so none of it is cacheable.
- `/l/[slug]` (short-link redirect): dynamic. Resolves per request and records
  analytics via `runInBackground()` after responding.

## Incremental cache

R2 incremental cache stays disabled in v1. There is no ISR or on-demand
revalidation surface, so the default in-Worker cache is sufficient. Revisit if a
later phase adds ISR.
```

- [ ] **Step 8: Commit**

```bash
git add open-next.config.ts src/app/page.tsx docs/architecture/caching.md
git commit -m "perf(cache): make v1 caching posture explicit per master plan section 13"
```

(Add the `/portal` layout and `/l/[slug]` route files to this commit if Steps 3-4 edited them.)

---

### Task 7: Security review against the §10 checklist

**Files:**
- Create: `docs/architecture/security-review-phase-9.md`
- Modify: `docs/architecture/security.md` (link the review, add the rate-limit entry)
- Modify: any file where the review finds a real gap (each fix is its own commit)

**Interfaces:**
- Consumes: the whole built app. This is an audit, not a feature.
- Produces: a checklist document with a pass/fail/n-a verdict per §10 line, evidence (file + test name) for each pass, and a tracked fix for each fail.

- [ ] **Step 1: Build the checklist skeleton from §10**

Create `docs/architecture/security-review-phase-9.md` with one row per master plan §10 item. Fill the Evidence column by orienting with graphify (do not grep blind), e.g. `graphify query "assertSameOrigin usage, mutating api handlers, cross-origin rejection test"`. The rows are exactly:

```md
# Phase 9 security review

Reviewed against master plan section 10. Each row: control, status
(pass / fail / n-a-deferred), evidence (file + test), notes.

| Control (section 10) | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Auth.js DB sessions, httpOnly/Secure cookie, revocable, sign-out deletes row | | | |
| AUTH_SECRET per env, trustHost true | | | |
| Server-side authz in repositories on every mutation + admin read | | | |
| Ownership + team/ACL checks (team/ACL n-a: content system deferred, section 11) | | | |
| Uploads: auth + server-assigned keys + content-type/size limits + authorized GET/DELETE | | | |
| Auth.js CSRF for auth routes | | | |
| assertSameOrigin on our mutating /api/* + server actions | | | |
| Rate limits on auth / link-create / scan | | | |
| Short-link destination validation (http/https), open-redirect guard | | | |
| Shared API: bearer -> seeded actor, per-op auth/permission/sharedDev gating, no raw SQL | | | |
| Destructive ops denied in shared mode | | | |
| /internal/* returns 404 unless DEPLOY_ENV=dev; env.ts rejects shared config on prod | | | |
| No secrets client-side; bindings confined to adapters/internal modules | | | |
| PII (emails, birthdays) members-only; birthday privacy honored in calendar | | | |
| Survey anonymity: responses carry only survey_id; one-submit conditional update | | | |
| Forum anonymity: member_id stored, identity hidden except super reveal (audited) | | | |
| Audit row on every successful admin mutation | | | |
```

- [ ] **Step 2: Fill each row with evidence**

For each row, use graphify then read the cited file to confirm the control is actually present and, where a test exists, name it. Mark `n-a-deferred` for controls whose subsystem is deferred (team/ACL, content), citing §11. Mark `fail` only with a concrete, reproducible gap.

- [ ] **Step 3: Fix any real gaps found**

For each `fail`, write a failing test that demonstrates the gap, fix it, confirm the test passes, and commit that single fix on its own (`fix(security): ...`). If the review is clean, skip this step and record "no gaps found" in the doc. Do not invent speculative hardening beyond the §10 checklist (YAGNI).

- [ ] **Step 4: Link the review from the security doc**

In `docs/architecture/security.md`, under `## Rules`, add a line pointing to the review and a line recording the new rate-limit control:
```md
- Auth, link-create, and scan routes are rate-limited (D1 fixed-window counter, `src/server/ratelimit/`).
- Phase 9 security review: see `docs/architecture/security-review-phase-9.md`.
```

- [ ] **Step 5: Commit the review**

```bash
git add docs/architecture/security-review-phase-9.md docs/architecture/security.md
git commit -m "docs(security): add phase 9 security review against section 10 checklist"
```

---

### Task 8: Docs refresh

**Files:**
- Modify: `docs/README.md` (index the new caching + security-review + e2e docs)
- Modify: `docs/reference/commands.md` (add `test:e2e`)
- Modify: `README.md` (add a "Testing" pointer covering unit + integration + E2E)
- Modify: `docs/architecture/overview.md` (note the rate-limit module + caching posture)

**Interfaces:**
- Consumes: the docs delivered by Tasks 4, 6, 7.
- Produces: a docs tree where a new contributor can find the test commands, the caching posture, and the security review from the index.

- [ ] **Step 1: Orient on the current docs index**

Run: `graphify query "docs README index, commands reference, testing documentation"` then read `docs/README.md` and `docs/reference/commands.md` to match their existing structure before editing.

- [ ] **Step 2: Add the E2E command to the commands reference**

In `docs/reference/commands.md`, in the testing section, add a row/line:
```md
- `pnpm test:e2e` — Playwright E2E suite (boots `next dev` with `APP_ENV=local`, needs the local DB seeded first: `pnpm db:migrate:local:sqlite && pnpm db:seed:local`).
```

- [ ] **Step 3: Add a Testing pointer to the root README**

In `README.md`, add a short "Testing" subsection:
```md
## Testing

- `pnpm test` — unit + integration (Vitest, Cloudflare Workers pool).
- `pnpm test:e2e` — light Playwright happy-path suite. See `e2e/README.md`.
```

- [ ] **Step 4: Index the new architecture docs**

In `docs/README.md`, add links to `docs/architecture/caching.md` and `docs/architecture/security-review-phase-9.md` alongside the existing architecture entries, matching the existing list style.

- [ ] **Step 5: Note the rate-limit module in the overview**

In `docs/architecture/overview.md`, add one line to the relevant section: "Abuse-prone routes (auth, link-create, scan) are rate-limited by a D1 fixed-window counter in `src/server/ratelimit/`."

- [ ] **Step 6: Confirm no em dashes and no stale references**

Run: `graphify query "deferred subsystems, announcements, articles, content publishing references in docs"` to find any doc still describing deferred subsystems as live, then fix wording. Manually confirm none of the edited docs introduced an em dash.

- [ ] **Step 7: Commit**

```bash
git add docs/README.md docs/reference/commands.md README.md docs/architecture/overview.md
git commit -m "docs: refresh for phase 9 rate limits, caching, and e2e testing"
```

---

### Task 9: Shared-dev onboarding verification + CI guard wiring + dev-Worker redeploy

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `docs/operations/shared-dev-deploy-note.md` (add the Phase 9 entry)
- Modify: `docs/setup/shared-dev-onboarding.md` (record the verification result)

**Interfaces:**
- Consumes: the existing `scripts/check-shared-dev-note.ts` guard (wired to `pnpm check:shared-dev-note`) and the existing `pnpm typecheck` / `lint` / `test` / `build` scripts.
- Produces: a CI workflow that runs the gate suite and the shared-dev guard on PRs, a verified onboarding path, and the approval-gated dev-Worker redeploy that this phase's schema + config changes require.

**Status finding (verify-first deliverable):** Master plan §15 calls the shared-dev guard a "Phase 0 CI/PR guard". The guard LOGIC exists today as `scripts/check-shared-dev-note.ts` (run via `pnpm check:shared-dev-note`); it diffs `HEAD` and fails when a shared-dev-sensitive file (`src/db/schema.ts`, `drizzle/migrations/`, `src/db/contract/`, `src/app/internal/`, `src/server/auth/permissions.ts`, `src/auth.ts`) changes without a deploy note. BUT there is no `.github/` directory and no CI runner in the repo, so the guard is currently only runnable manually and is NOT enforced on PRs. Phase 9 closes that gap by adding the workflow below. Confirm this is still true at execution time with `git status` and a check for `.github/`.

- [ ] **Step 1: Confirm the gap still exists**

Run:
```bash
ls .github/workflows 2>/dev/null || echo "no workflows dir"
pnpm check:shared-dev-note
```
Expected: "no workflows dir" (confirming the guard is not yet in CI), and the guard script prints "Shared dev deploy note check passed." on a clean tree. If a workflows dir already exists, adapt rather than overwrite.

- [ ] **Step 2: Add the CI workflow that runs the gate suite + the guard**

Create `.github/workflows/ci.yml`:
```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main, beta]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm db:generate && git diff --exit-code drizzle/migrations
      - run: pnpm build
      - run: pnpm check:shared-dev-note
```
This implements the master plan §8 "CI gates" (`typecheck`, `lint`, `test`, clean `drizzle-kit generate`, `build`) AND finally enforces the §15 shared-dev guard on every PR.

- [ ] **Step 3: Note that the guard's HEAD-diff basis is CI-appropriate**

`check-shared-dev-note.ts` diffs `HEAD` (working tree vs last commit). In CI on a PR, the meaningful comparison is the PR's diff against the base branch. If the guard run in Step 2 produces a false pass/fail in CI because the working tree is clean post-checkout, change the guard's `changedFiles()` to diff against the base ref when `GITHUB_BASE_REF` is set:
```ts
function changedFiles(): string[] {
	const base = process.env.GITHUB_BASE_REF;
	const range = base ? [`origin/${base}...HEAD`] : ["--name-only", "HEAD"];
	const args = base ? ["diff", "--name-only", ...range] : ["diff", ...range];
	const output = git(args);
	return output ? output.split(/\r?\n/).filter(Boolean) : [];
}
```
This is a real fix the existing single-commit guard needs to work in CI; make it and re-run `pnpm check:shared-dev-note` locally to confirm the local path still passes. (Editing `scripts/check-shared-dev-note.ts` is itself NOT a shared-dev-sensitive path, so it does not trip its own guard.)

- [ ] **Step 4: Verify the shared-dev onboarding path end to end**

Walk `docs/setup/shared-dev-onboarding.md` as a new outside developer would. Confirm each documented step still matches reality after the v5 + Phase 9 changes: the `APP_ENV=shared` env vars, `SHARED_API_BASE_URL` / `SHARED_API_TOKEN`, and that the `/internal/*` routes the doc references still exist (`graphify query "internal api routes, shared dev token, APP_ENV shared onboarding"`). Fix any stale step in the doc. Record the verification outcome (date + "verified against Phase 9") at the top of the onboarding doc.

- [ ] **Step 5: Add the Phase 9 shared-dev deploy note**

This phase changed `src/db/schema.ts` (rate-limit table) and auth config (the auth route wrapper), which are shared-dev-sensitive. Add an entry to `docs/operations/shared-dev-deploy-note.md` recording that Phase 9 requires `pnpm db:migrate:dev` + `pnpm deploy:dev`, satisfying the guard for this phase's commits.

- [ ] **Step 6: Commit the CI + docs**

```bash
git add .github/workflows/ci.yml scripts/check-shared-dev-note.ts docs/operations/shared-dev-deploy-note.md docs/setup/shared-dev-onboarding.md
git commit -m "ci: enforce gate suite and shared-dev guard on PRs

Wires the existing check-shared-dev-note guard into CI (master plan
section 15) and verifies the shared-dev onboarding path."
```

- [ ] **Step 7: STOP — surface the dev-Worker redeploy obligation, do not run it without approval**

Per CLAUDE.md and master plan §15, the rate-limit schema change and auth-route change require migrating and redeploying the dev Worker. Present these commands to the user and wait for explicit approval before running either:
```bash
pnpm db:migrate:dev
pnpm deploy:dev
```
Expected after approval: dev D1 has `rate_limit_counters`; the dev Worker serves the rate-limited auth route. Shared-mode developers are unaffected by the rate limit beyond the new table existing (the limiter runs on the dev Worker, not the shared client).

---

## Self-review notes (for the implementer, not a step to execute)

- **Spec coverage:** every Phase 9 deliverable from master plan §12 ("rate limits, security review, Playwright E2E, OpenNext caching pass (§13), docs refresh, shared-dev onboarding verification") maps to a task: rate limits = Tasks 1-3; Playwright E2E = Tasks 4-5 (the exact §8 scenario list: mocked-OAuth sign-in, create link, RSVP + simulated scan, manual retention record, assign role); security review = Task 7 (against the §10 checklist); OpenNext caching pass = Task 6 (encodes the §13 decisions: `/` static, `/portal/*` + `/l/[slug]` dynamic, no R2 incremental cache); docs refresh = Task 8; shared-dev onboarding verification = Task 9.
- **§15 CI/PR guard status (the verify-first ask):** confirmed the guard exists as `scripts/check-shared-dev-note.ts` + `pnpm check:shared-dev-note`, but there is NO `.github/` directory and no CI runner, so it is not enforced on PRs today. Task 9 wires it into a new `.github/workflows/ci.yml` and fixes its diff basis for CI. This is called out as a finding, not assumed already-done.
- **Sequencing:** Phase 9 is last because Tasks 4-5 drive Phase 3/4/5/8 UI. The "Sequencing & Dependency Gate" section maps each E2E scenario to its blocking phase and tells the executor to run only the independent tasks (1, 2, 3-core, 6, 7, 8, 9) and the Phase-1 sign-in E2E if later phases are unmerged. This satisfies the requirement to draft now but sequence last.
- **Type consistency:** `checkRateLimit` / `RateLimitResult` / `RateLimitOptions` (Task 1) are consumed verbatim by `policies.ts` (Task 2) and `guard.ts` (Task 3); `enforceRateLimit` and `RATE_LIMITS` keys (`authSignin`/`linkCreate`/`scanSubmit`) are stable across Tasks 2-3 and 5. `signInAs(page, role)` with `SeededRole = "admin" | "member"` (Task 4) is reused unchanged in every spec in Task 5. Role/scope strings (`link`, `retention`, `member_admin`, `roster:manage`, `nav:configure`) match the v5 foundation plan and master plan §5.
- **No placeholders:** every code step shows the full code; every command step shows the exact command and expected output; gaps that genuinely depend on unmerged phases (the Task 3 handler binding, the Task 5 specs, the `/l/[slug]` flag) are explicitly marked as blocked-on-phase with an instruction to STOP rather than stub, which is the correct handling for a last-phase plan, not a placeholder.
- **Approval gates:** every D1 / dev-Worker operation (Task 1 Step 8, Task 4 Step 5, Task 9 Step 7) is STOP-and-show-the-command per CLAUDE.md.

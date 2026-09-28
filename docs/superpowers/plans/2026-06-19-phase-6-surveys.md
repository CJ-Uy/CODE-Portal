# Phase 6 — Surveys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 surveys feature end to end: admins create surveys (with questions), draw a deterministic random sample of members and issue per-assignment opaque tokens, members submit responses anonymously through a token-gated flow, and admins read aggregated results that can never be traced back to an individual member.

**Architecture:** Surveys follow the exact data-access pattern already used by `members`: one `src/db/repositories/surveys.ts` module of pure async functions that each take an explicit `actor`, call `permissions.can()` before any privileged read/write, and `audit.record()` after privileged writes. A typed `src/db/contract/surveys.ts` declares each operation's `auth` / `permission` / `sharedDev` so the dev Worker's `/internal/surveys` routes and the in-app `/api` + server-action paths share one authorization shape. Anonymity is structural: `survey_responses` carry only `survey_id`, and the submit path uses a conditional `UPDATE survey_assignments ... WHERE response_token_hash = ? AND completed_at IS NULL RETURNING ...` that proceeds only when exactly one row is affected — so a valid token is consumed once and there is no join key from any response back to a member.

**Tech Stack:** Drizzle ORM (SQLite dialect, D1) over the existing `getDb()` handle; Zod schemas in `src/db/types.ts` + `src/db/contract/surveys.ts`; Auth.js-resolved actor via `getActor()`; `crypto.subtle` SHA-256 for token hashing (same primitive as `src/server/internal/shared-actor.ts`); Vitest + `@cloudflare/vitest-pool-workers` (the existing `vitest.config.mts` auto-applies `drizzle/migrations` to an ephemeral D1 in `beforeAll`); Next.js 16 App Router server components + server actions; shadcn/ui local registry (`src/components/ui`) + Tailwind v4 tokens.

## Global Constraints

These are copied from the master plan's Global Constraints and §6/§8 and apply to every task below.

- Drizzle schema at `src/db/schema.ts` is the ONE source of truth. The survey tables (`surveys`, `survey_questions`, `survey_assignments`, `survey_responses`, `survey_answers`) ALREADY EXIST in the schema and migrations — this phase adds NO new tables and NO migration. Do not edit `src/db/schema.ts`; if a query needs a column that is not there, stop and raise it rather than altering the schema.
- Every repository function takes an explicit `actor` and calls `can(actor, action)` before any privileged read/write; every successful admin mutation calls `audit.record(actor, ...)` with `category: "survey"`. Authorization lives in the repository/service layer so it holds identically across access modes.
- Mutating `/api/*` handlers (cookie-authenticated, same-origin) call `assertSameOrigin(request)` from `@/server/http/origin`. `/internal/*` handlers are cross-origin: they return 404 unless `DEPLOY_ENV === "dev"`, authenticate with the shared bearer token via `resolveSharedActor`, use NO cookie auth, and apply the CORS allowlist via `getInternalCorsHeaders`. Destructive/admin ops require BOTH the actor's permission AND `sharedDev: "allow"`.
- D1 budget: ≤ 100 bound params and ≤ 100 KB per statement; no unbounded `SELECT` (paginate with a default + max page size, reuse `pageLimit()` from `src/db/repositories/types.ts`); every query has a backing index (the existing survey indexes are `surveys_status_idx`, `surveys_event_id_idx`, `survey_questions_survey_id_idx`, `survey_assignments_member_id_idx`, `survey_assignments_response_token_hash_idx`); prefer set-based queries and `db.batch()` for multi-statement writes (D1 has no interactive transactions).
- True anonymity (master plan §6 surveys + §14 v2 #14 / v3 #4): `survey_responses` carry ONLY `survey_id` — no `member_id`, no assignment ref, no token. The submit gate is a conditional `UPDATE survey_assignments SET completed_at = now WHERE response_token_hash = ? AND completed_at IS NULL` that proceeds ONLY if it affected exactly 1 row, then inserts the anonymous response + answers via `db.batch()`. A crash between the update and the insert leaves an assignment marked complete with no response — a rare, acceptable lost slot (documented in code comments, no em dashes).
- The random sample uses a SEEDED, deterministic RNG so the same `(surveyId, eligible-member-set, seed)` always yields the same sample, and the sampling unit test is deterministic (master plan §8 "survey seeded-RNG sampling (deterministic)").
- No auto-trigger on event close (master plan §11 #5): surveys are a fully MANUAL admin feature. A survey MAY reference an `event_id`, but nothing in this phase creates or launches a survey automatically when an event ends. Do not add any event-close hook.
- Permission action for all survey admin operations is the EXISTING `"survey:configure"` (already in `permissionActions`); no new permission strings are added in this phase.
- Member workspace lives under `/portal`; the member-facing survey page is `/portal/surveys/[id]` (master plan §1). Admin surface is `/portal/admin/surveys`. `export const dynamic = "force-dynamic"` on every portal/admin page (master plan §13).
- UI is built from the shadcn/ui local registry (`src/components/ui`: `button`, `card`, `input`, `textarea`, `select`, `checkbox`, `badge`, `tabs` already exist) themed via `src/app/globals.css` tokens. No CSS-in-JS, no ad-hoc global CSS. No em dashes in UI copy, code comments, docs, or commits. Cards stay shallow (no cards inside cards).
- After this phase lands (it changes the internal contract `src/db/contract/*` and adds `src/app/internal/surveys/*`), the dev Worker must be redeployed per CLAUDE.md and master-plan §15. Surfaced as the final, approval-gated step. Show the exact `pnpm exec wrangler` / `pnpm db:*` command and wait for approval before any D1 or dev-Worker operation.

---

### Task 1: Survey domain types and Zod input schemas

**Files:**
- Modify: `src/db/types.ts` (append survey types + schemas at end of file)

**Interfaces:**
- Consumes: `SurveyStatus`, `SurveyQuestionType` from `@/db/schema` (already exported there); `surveys`, `surveyQuestions`, `surveyAssignments`, `surveyResponses`, `surveyAnswers` table types via `InferSelectModel`.
- Produces: `Survey`, `SurveyQuestion`, `SurveyAssignment`, `SurveyResponse`, `SurveyAnswer` row types; `createSurveyInputSchema` / `CreateSurveyInput`; `sampleSurveyInputSchema` / `SampleSurveyInput`; `submitSurveyResponseInputSchema` / `SubmitSurveyResponseInput`; `surveyResultsQuestionSchema` and `SurveyResults` type. Tasks 3-8 consume these exact names.

- [ ] **Step 1: Append the survey row types and input schemas**

At the END of `src/db/types.ts`, add. Note the file already imports `InferSelectModel`, `InferInsertModel`, and `z`; add the survey table imports to the existing `from "./schema"` import line rather than duplicating it.

First, extend the existing schema import (currently `import type { members } from "./schema";`) to:
```ts
import type {
	members,
	surveys,
	surveyQuestions,
	surveyAssignments,
	surveyResponses,
	surveyAnswers,
} from "./schema";
import type { SurveyQuestionType } from "./schema";
```

Then append at end of file:
```ts
export type Survey = InferSelectModel<typeof surveys>;
export type SurveyQuestion = InferSelectModel<typeof surveyQuestions>;
export type SurveyAssignment = InferSelectModel<typeof surveyAssignments>;
export type SurveyResponse = InferSelectModel<typeof surveyResponses>;
export type SurveyAnswer = InferSelectModel<typeof surveyAnswers>;

// A survey is created together with its ordered questions in one call so the
// admin form is a single submit. Choice/scale questions carry their options.
export const surveyQuestionInputSchema = z.object({
	type: z.enum(["scale", "text", "choice"]),
	prompt: z.string().trim().min(1).max(500),
	options: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
});

export type SurveyQuestionInput = z.infer<typeof surveyQuestionInputSchema>;

export const createSurveyInputSchema = z.object({
	title: z.string().trim().min(1).max(200),
	eventId: z.string().trim().min(1).nullable().optional(),
	questions: z.array(surveyQuestionInputSchema).min(1).max(30),
});

export type CreateSurveyInput = z.infer<typeof createSurveyInputSchema>;

// Drawing the sample also flips the survey to running. sampleSize is the number
// of members to draw; seed makes the draw deterministic and testable.
export const sampleSurveyInputSchema = z.object({
	surveyId: z.string().trim().min(1),
	sampleSize: z.number().int().min(1).max(1000),
	seed: z.string().trim().min(1).max(120).optional(),
});

export type SampleSurveyInput = z.infer<typeof sampleSurveyInputSchema>;

export const surveyAnswerInputSchema = z.object({
	questionId: z.string().trim().min(1),
	value: z.string().trim().min(1).max(2000),
});

// The raw token travels in the body; the server hashes it and never stores it.
export const submitSurveyResponseInputSchema = z.object({
	surveyId: z.string().trim().min(1),
	token: z.string().trim().min(1).max(200),
	answers: z.array(surveyAnswerInputSchema).min(1).max(30),
});

export type SubmitSurveyResponseInput = z.infer<typeof submitSurveyResponseInputSchema>;

// Aggregated, identity-free results. Per question we expose only counts.
export type SurveyResultsQuestion = {
	questionId: string;
	prompt: string;
	type: SurveyQuestionType;
	answerCount: number;
	// For scale/choice: value -> count. For text: omitted (texts listed separately).
	valueCounts?: Record<string, number>;
	// For text: the raw answer strings, with no ordering tie to any member.
	textAnswers?: string[];
};

export type SurveyResults = {
	surveyId: string;
	title: string;
	status: SurveyStatus;
	assignedCount: number;
	completedCount: number;
	questions: SurveyResultsQuestion[];
};
```

Add `SurveyStatus` to the type-only import from `./schema` as well (so `SurveyResults` compiles):
```ts
import type { SurveyStatus } from "./schema";
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS. These are additive type/schema exports with no consumers yet.

- [ ] **Step 3: Commit**

```bash
git add src/db/types.ts
git commit -m "feat(surveys): add survey domain types and input schemas"
```

---

### Task 2: Deterministic seeded sample helper (pure, unit-tested)

**Files:**
- Create: `src/lib/sample.ts`
- Create: `src/lib/sample.test.ts`

**Interfaces:**
- Produces: `seededSample<T>(items: T[], size: number, seed: string): T[]` — returns a deterministic subset of `items` of length `min(size, items.length)`, stable for the same `(items order, size, seed)`. Task 4's `surveys.sample()` consumes it.

- [ ] **Step 1: Write the failing test**

Create `src/lib/sample.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { seededSample } from "./sample";

const ITEMS = Array.from({ length: 20 }, (_, i) => `m${i}`);

describe("seededSample", () => {
	it("is deterministic for the same items, size, and seed", () => {
		const a = seededSample(ITEMS, 5, "survey-123");
		const b = seededSample(ITEMS, 5, "survey-123");
		expect(a).toEqual(b);
	});

	it("returns a different draw for a different seed", () => {
		const a = seededSample(ITEMS, 5, "seed-a");
		const b = seededSample(ITEMS, 5, "seed-b");
		expect(a).not.toEqual(b);
	});

	it("returns exactly size items when the pool is larger", () => {
		expect(seededSample(ITEMS, 7, "x")).toHaveLength(7);
	});

	it("returns the whole pool when size exceeds it", () => {
		const result = seededSample(ITEMS, 50, "x");
		expect(result).toHaveLength(ITEMS.length);
		expect([...result].sort()).toEqual([...ITEMS].sort());
	});

	it("returns no duplicates", () => {
		const result = seededSample(ITEMS, 10, "x");
		expect(new Set(result).size).toBe(result.length);
	});

	it("returns an empty array for size 0 or empty pool", () => {
		expect(seededSample(ITEMS, 0, "x")).toEqual([]);
		expect(seededSample([], 5, "x")).toEqual([]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- sample.test.ts`
Expected: FAIL with a module-not-found error for `./sample`.

- [ ] **Step 3: Write `src/lib/sample.ts`**

```ts
// Deterministic, seedable sampling without a dependency. A small string hash
// seeds a mulberry32 PRNG, which drives a partial Fisher-Yates shuffle. Given
// the same input order, size, and seed, the output is always identical, so the
// survey sample is reproducible and unit-testable.
function hashSeed(seed: string): number {
	let h = 1779033703 ^ seed.length;
	for (let i = 0; i < seed.length; i += 1) {
		h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	return h >>> 0;
}

function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function seededSample<T>(items: T[], size: number, seed: string): T[] {
	const count = Math.max(0, Math.min(size, items.length));
	if (count === 0) return [];

	const pool = [...items];
	const random = mulberry32(hashSeed(seed));
	for (let i = 0; i < count; i += 1) {
		const j = i + Math.floor(random() * (pool.length - i));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	return pool.slice(0, count);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- sample.test.ts`
Expected: PASS (all 6 cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sample.ts src/lib/sample.test.ts
git commit -m "feat(surveys): add deterministic seeded sample helper"
```

---

### Task 3: Survey response-token hashing helper (pure, unit-tested)

**Files:**
- Create: `src/lib/survey-token.ts`
- Create: `src/lib/survey-token.test.ts`

**Interfaces:**
- Produces: `generateResponseToken(): string` (an opaque random token given to a member, never stored) and `hashResponseToken(token: string): Promise<string>` (SHA-256 hex; only this is stored in `survey_assignments.response_token_hash`). Task 4 (`surveys.sample()` stores hashes) and Task 5 (`surveys.submitResponse()` looks up by hash) consume both.

- [ ] **Step 1: Write the failing test**

Create `src/lib/survey-token.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { generateResponseToken, hashResponseToken } from "./survey-token";

describe("survey-token", () => {
	it("generates distinct, non-empty tokens", () => {
		const a = generateResponseToken();
		const b = generateResponseToken();
		expect(a).not.toBe(b);
		expect(a.length).toBeGreaterThanOrEqual(20);
	});

	it("hashes a token to a stable 64-char hex digest", async () => {
		const hash = await hashResponseToken("token-abc");
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		await expect(hashResponseToken("token-abc")).resolves.toBe(hash);
	});

	it("produces different hashes for different tokens", async () => {
		await expect(hashResponseToken("a")).resolves.not.toBe(await hashResponseToken("b"));
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- survey-token.test.ts`
Expected: FAIL with a module-not-found error for `./survey-token`.

- [ ] **Step 3: Write `src/lib/survey-token.ts`**

```ts
// The opaque per-assignment token is the ONLY link between a member and their
// survey slot, and it is never stored: we keep only its SHA-256 hash. The raw
// token is handed to the member (via their assignment) and presented back on
// submit. Because survey_responses store only survey_id, hashing here is what
// keeps responses unlinkable to members.
export function generateResponseToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashResponseToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- survey-token.test.ts`
Expected: PASS (all 3 cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/survey-token.ts src/lib/survey-token.test.ts
git commit -m "feat(surveys): add response-token generate and hash helpers"
```

---

### Task 4: Surveys repository — create, sample, list, get (admin paths)

**Files:**
- Modify: `src/db/repositories/surveys.ts` (replace the stub in full)
- Create: `src/db/repositories/surveys.integration.test.ts`

**Interfaces:**
- Consumes: `seededSample` (Task 2), `generateResponseToken` + `hashResponseToken` (Task 3); `CreateSurveyInput`, `SampleSurveyInput`, `Survey`, `SurveyQuestion` (Task 1); `Actor` + `can` from `@/server/auth/permissions`; `AuditRepository` from `./audit`; `createId` from `@/lib/ids`; survey tables + `members` from `@/db/schema`.
- Produces: `SurveysRepository` with `create(actor, input): Promise<Survey>`, `sample(actor, input): Promise<{ assigned: number; tokens: Array<{ memberId: string; token: string }> }>`, `list(actor, input?): Promise<Survey[]>`, `getById(actor, id): Promise<{ survey: Survey; questions: SurveyQuestion[] } | null>`. `createSurveysRepository(db, audit)` factory. Tasks 5, 6, 7, 8 consume these.

- [ ] **Step 1: Write the failing integration test**

Create `src/db/repositories/surveys.integration.test.ts`:
```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { surveyAssignments, surveys } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createSurveysRepository } from "./surveys";

const admin: Actor = { memberId: "mem_admin", roles: ["super"] };
const member: Actor = { memberId: "mem_member", roles: ["member"] };

async function seedMembers(count: number) {
	for (let i = 0; i < count; i += 1) {
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind(`mem_${i}`, `m${i}@example.com`, `M${i}`, "active")
			.run();
	}
}

describe("surveys repository on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM survey_answers").run();
		await env.DB.prepare("DELETE FROM survey_responses").run();
		await env.DB.prepare("DELETE FROM survey_assignments").run();
		await env.DB.prepare("DELETE FROM survey_questions").run();
		await env.DB.prepare("DELETE FROM surveys").run();
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind("mem_admin", "admin@example.com", "Admin", "active")
			.run();
	});

	it("creates a survey with ordered questions and audits it", async () => {
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));

		const survey = await repo.create(admin, {
			title: "Practice Night Feedback",
			questions: [
				{ type: "scale", prompt: "How useful was it?", options: ["1", "2", "3", "4", "5"] },
				{ type: "text", prompt: "Anything to add?" },
			],
		});

		const detail = await repo.getById(admin, survey.id);
		const [audit] = await db.select().from(schema.auditLogs);
		expect(survey.status).toBe("draft");
		expect(detail?.questions).toHaveLength(2);
		expect(detail?.questions[0].position).toBe(1);
		expect(detail?.questions[1].position).toBe(2);
		expect(audit).toMatchObject({ action: "survey:create", category: "survey", targetId: survey.id });
	});

	it("rejects create for a non-admin actor", async () => {
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		await expect(repo.create(member, { title: "X", questions: [{ type: "text", prompt: "Q" }] })).rejects.toThrow(
			"Not authorized",
		);
	});

	it("draws a deterministic sample, stores only token hashes, and flips to running", async () => {
		await seedMembers(10);
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q" }] });

		const first = await repo.sample(admin, { surveyId: survey.id, sampleSize: 4, seed: "fixed" });
		const assignments = await db.select().from(surveyAssignments).where(eq(surveyAssignments.surveyId, survey.id));
		const [running] = await db.select().from(surveys).where(eq(surveys.id, survey.id));

		expect(first.assigned).toBe(4);
		expect(first.tokens).toHaveLength(4);
		expect(assignments).toHaveLength(4);
		// Only hashes are persisted; a raw token never equals a stored hash.
		const hashes = new Set(assignments.map((a) => a.responseTokenHash));
		expect(first.tokens.every((t) => !hashes.has(t.token))).toBe(true);
		expect(running.status).toBe("running");
		expect(running.sampleSize).toBe(4);
	});

	it("rejects sampling a survey that is not draft", async () => {
		await seedMembers(5);
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q" }] });
		await repo.sample(admin, { surveyId: survey.id, sampleSize: 2, seed: "a" });
		await expect(repo.sample(admin, { surveyId: survey.id, sampleSize: 2, seed: "a" })).rejects.toThrow(
			"already been sampled",
		);
	});

	it("rejects list/get for a non-admin actor", async () => {
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		await expect(repo.list(member)).rejects.toThrow("Not authorized");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- surveys.integration.test.ts`
Expected: FAIL — `createSurveysRepository` currently returns `{}`, so `repo.create` is not a function.

- [ ] **Step 3: Replace `src/db/repositories/surveys.ts` in full**

```ts
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { members, surveyAssignments, surveyQuestions, surveys } from "@/db/schema";
import { createId } from "@/lib/ids";
import { seededSample } from "@/lib/sample";
import { generateResponseToken, hashResponseToken } from "@/lib/survey-token";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { CreateSurveyInput, SampleSurveyInput, Survey, SurveyQuestion } from "../types";
import { pageLimit } from "./types";
import type { AuditRepository } from "./audit";

type SurveyDb = DrizzleD1Database<typeof schema>;

export type SampleResult = {
	assigned: number;
	tokens: Array<{ memberId: string; token: string }>;
};

export type SurveysRepository = {
	create(actor: Actor, input: CreateSurveyInput): Promise<Survey>;
	sample(actor: Actor, input: SampleSurveyInput): Promise<SampleResult>;
	list(actor: Actor, input?: { limit?: number }): Promise<Survey[]>;
	getById(actor: Actor, id: string): Promise<{ survey: Survey; questions: SurveyQuestion[] } | null>;
};

export function createSurveysRepository(db: SurveyDb, audit: AuditRepository): SurveysRepository {
	return {
		async create(actor, input) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to create surveys.");

			const surveyId = createId("srv");
			const [survey] = await db
				.insert(surveys)
				.values({
					id: surveyId,
					title: input.title,
					eventId: input.eventId ?? null,
					status: "draft",
					createdBy: actor.memberId,
				})
				.returning();

			const questionRows = input.questions.map((question, index) => ({
				id: createId("srvq"),
				surveyId,
				position: index + 1,
				type: question.type,
				prompt: question.prompt,
				optionsJson: question.options ? JSON.stringify(question.options) : null,
			}));
			// Bounded to 30 questions by the input schema, well within the D1 budget.
			await db.insert(surveyQuestions).values(questionRows);

			await audit.record(actor, {
				action: "survey:create",
				targetType: "survey",
				targetId: surveyId,
				category: "survey",
			});
			return survey;
		},

		async sample(actor, input) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to sample surveys.");

			const [survey] = await db.select().from(surveys).where(eq(surveys.id, input.surveyId)).limit(1);
			if (!survey) throw new Error("Survey not found.");
			if (survey.status !== "draft") throw new Error("Survey has already been sampled.");

			const eligible = await db
				.select({ id: members.id })
				.from(members)
				.where(eq(members.status, "active"))
				.orderBy(asc(members.id));
			const drawn = seededSample(
				eligible.map((row) => row.id),
				input.sampleSize,
				input.seed ?? input.surveyId,
			);

			const tokens: Array<{ memberId: string; token: string }> = [];
			const assignmentRows = [] as Array<{
				surveyId: string;
				memberId: string;
				responseTokenHash: string;
			}>;
			for (const memberId of drawn) {
				const token = generateResponseToken();
				tokens.push({ memberId, token });
				assignmentRows.push({
					surveyId: input.surveyId,
					memberId,
					responseTokenHash: await hashResponseToken(token),
				});
			}

			if (assignmentRows.length > 0) {
				// Chunk to respect the D1 100-bound-param budget (3 params/row -> 33 rows/stmt).
				for (let i = 0; i < assignmentRows.length; i += 33) {
					await db.insert(surveyAssignments).values(assignmentRows.slice(i, i + 33));
				}
			}

			await db
				.update(surveys)
				.set({ status: "running", sampleSize: assignmentRows.length })
				.where(eq(surveys.id, input.surveyId));

			await audit.record(actor, {
				action: "survey:sample",
				targetType: "survey",
				targetId: input.surveyId,
				category: "survey",
				detail: `Assigned ${assignmentRows.length} members.`,
			});
			return { assigned: assignmentRows.length, tokens };
		},

		async list(actor, input) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to list surveys.");
			return db.select().from(surveys).orderBy(surveys.createdAt).limit(pageLimit(input?.limit));
		},

		async getById(actor, id) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to read this survey.");
			const [survey] = await db.select().from(surveys).where(eq(surveys.id, id)).limit(1);
			if (!survey) return null;
			const questions = await db
				.select()
				.from(surveyQuestions)
				.where(eq(surveyQuestions.surveyId, id))
				.orderBy(asc(surveyQuestions.position));
			return { survey, questions };
		},
	};
}

// Re-exported so the unused import lint does not flag and/isNull if a later edit
// drops them; they back the assignment-status helpers used by Task 5/6.
export const surveyQueryFragments = { and, isNull };
```

Note: the trailing `surveyQueryFragments` export exists only so `and`/`isNull` are referenced; Task 5 moves the submit logic that uses them into this file and removes this shim. If `pnpm lint` flags `and`/`isNull` as unused at this task boundary, that shim keeps the task green until Task 5.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- surveys.integration.test.ts`
Expected: PASS (all 5 cases green).

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. `repositories/index.ts` still calls `createSurveysRepository()` with NO arguments and will now be a type error if the factory requires args — fix that in Task 5 Step 1 (the index wiring), so if typecheck flags `index.ts` here, that is expected and resolved next task.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/surveys.ts src/db/repositories/surveys.integration.test.ts
git commit -m "feat(surveys): repository create, deterministic sample, list, get"
```

---

### Task 5: Surveys repository — anonymous submit + results, wire the factory args

**Files:**
- Modify: `src/db/repositories/surveys.ts` (add `submitResponse` + `getResults`, drop the `surveyQueryFragments` shim)
- Modify: `src/db/repositories/index.ts:9,22,44` (pass `db` + `audit` into `createSurveysRepository`)
- Modify: `src/db/repositories/surveys.integration.test.ts` (add submit + anonymity + results cases)

**Interfaces:**
- Consumes: everything from Task 4 plus `SubmitSurveyResponseInput`, `SurveyResults` (Task 1).
- Produces: `submitResponse(input: SubmitSurveyResponseInput): Promise<{ ok: true }>` (NO actor parameter — submission is token-authenticated, deliberately identity-free) and `getResults(actor: Actor, surveyId: string): Promise<SurveyResults>` on `SurveysRepository`. The factory now takes `(db, audit)` everywhere. Tasks 6, 7, 8 consume these.

- [ ] **Step 1: Wire the factory args in `src/db/repositories/index.ts`**

In `src/db/repositories/index.ts`, both repository builders call `createSurveysRepository()` with no args. Update both call sites to pass the same `db` + `audit` already in scope (the `audit` local exists in `createDrizzleRepositories`; in `createSharedRepositories` the surveys repo is unused over the proxy but still needs a valid handle — pass the `createUnavailableAuditRepository()` audit and the real `db` is not available there, so in the shared builder keep surveys backed by the drizzle factory is NOT possible). Resolve it exactly as follows.

In `createDrizzleRepositories(db)` change:
```ts
		surveys: createSurveysRepository(),
```
to:
```ts
		surveys: createSurveysRepository(db, audit),
```

In `createSharedRepositories(adapter)` the survey repo is never reachable over the shared proxy (all survey ops are admin/member in-app or via `/internal/surveys`), so replace:
```ts
		surveys: createSurveysRepository(),
```
with a thin unavailable stub inline:
```ts
		surveys: createUnavailableSurveysRepository(),
```
and add this export at the bottom of `src/db/repositories/surveys.ts` (Step 3 includes it):
```ts
export function createUnavailableSurveysRepository(): SurveysRepository {
	const unavailable = () => Promise.reject(new Error("Surveys are not available through this repository adapter."));
	return {
		create: unavailable,
		sample: unavailable,
		list: unavailable,
		getById: unavailable,
		submitResponse: unavailable,
		getResults: unavailable,
	} as unknown as SurveysRepository;
}
```
Add `createUnavailableSurveysRepository` to the import in `index.ts`:
```ts
import { createSurveysRepository, createUnavailableSurveysRepository } from "./surveys";
```

- [ ] **Step 2: Add the failing submit + results test cases**

Append these cases inside the existing `describe("surveys repository on D1", ...)` in `src/db/repositories/surveys.integration.test.ts`:
```ts
	it("accepts a valid token once, stores no member link, then rejects reuse", async () => {
		await seedMembers(3);
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		const survey = await repo.create(admin, {
			title: "S",
			questions: [{ type: "scale", prompt: "Rate", options: ["1", "2"] }],
		});
		const detail = await repo.getById(admin, survey.id);
		const questionId = detail!.questions[0].id;
		const { tokens } = await repo.sample(admin, { surveyId: survey.id, sampleSize: 1, seed: "fixed" });
		const token = tokens[0].token;

		await expect(
			repo.submitResponse({ surveyId: survey.id, token, answers: [{ questionId, value: "2" }] }),
		).resolves.toEqual({ ok: true });

		// The stored response carries only survey_id; there is no member column at all.
		const [response] = await db.select().from(schema.surveyResponses);
		expect(Object.keys(response)).toEqual(expect.arrayContaining(["id", "surveyId", "submittedAt"]));
		expect(Object.keys(response)).not.toContain("memberId");

		// The same token cannot be used a second time.
		await expect(
			repo.submitResponse({ surveyId: survey.id, token, answers: [{ questionId, value: "1" }] }),
		).rejects.toThrow("already been used");
	});

	it("rejects an unknown or wrong-survey token", async () => {
		await seedMembers(2);
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q" }] });
		const detail = await repo.getById(admin, survey.id);
		await repo.sample(admin, { surveyId: survey.id, sampleSize: 1, seed: "x" });
		await expect(
			repo.submitResponse({
				surveyId: survey.id,
				token: "not-a-real-token",
				answers: [{ questionId: detail!.questions[0].id, value: "hi" }],
			}),
		).rejects.toThrow("already been used");
	});

	it("aggregates identity-free results with assigned and completed counts", async () => {
		await seedMembers(3);
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		const survey = await repo.create(admin, {
			title: "S",
			questions: [
				{ type: "scale", prompt: "Rate", options: ["1", "2", "3"] },
				{ type: "text", prompt: "Why?" },
			],
		});
		const detail = await repo.getById(admin, survey.id);
		const [scaleQ, textQ] = detail!.questions;
		const { tokens } = await repo.sample(admin, { surveyId: survey.id, sampleSize: 2, seed: "x" });
		await repo.submitResponse({
			surveyId: survey.id,
			token: tokens[0].token,
			answers: [
				{ questionId: scaleQ.id, value: "3" },
				{ questionId: textQ.id, value: "Great session" },
			],
		});

		const results = await repo.getResults(admin, survey.id);
		expect(results.assignedCount).toBe(2);
		expect(results.completedCount).toBe(1);
		const scaleResult = results.questions.find((q) => q.questionId === scaleQ.id);
		expect(scaleResult?.valueCounts).toEqual({ "3": 1 });
		const textResult = results.questions.find((q) => q.questionId === textQ.id);
		expect(textResult?.textAnswers).toEqual(["Great session"]);
	});

	it("rejects getResults for a non-admin actor", async () => {
		const db = drizzle(env.DB, { schema });
		const repo = createSurveysRepository(db, createAuditRepository(db));
		const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q" }] });
		await expect(repo.getResults(member, survey.id)).rejects.toThrow("Not authorized");
	});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- surveys.integration.test.ts`
Expected: FAIL — `repo.submitResponse` and `repo.getResults` are not functions yet.

- [ ] **Step 4: Add `submitResponse` and `getResults` to `src/db/repositories/surveys.ts`**

In `src/db/repositories/surveys.ts`: extend the `SurveysRepository` type, add the two methods to the returned object, add the imports, and remove the `surveyQueryFragments` shim.

Update the imports line for tables/types:
```ts
import { members, surveyAnswers, surveyAssignments, surveyQuestions, surveyResponses, surveys } from "@/db/schema";
import { hashResponseToken, generateResponseToken } from "@/lib/survey-token";
import type {
	CreateSurveyInput,
	SampleSurveyInput,
	SubmitSurveyResponseInput,
	Survey,
	SurveyQuestion,
	SurveyResults,
	SurveyResultsQuestion,
} from "../types";
```

Add to the `SurveysRepository` type:
```ts
	submitResponse(input: SubmitSurveyResponseInput): Promise<{ ok: true }>;
	getResults(actor: Actor, surveyId: string): Promise<SurveyResults>;
```

Add these two methods inside the returned object (after `getById`):
```ts
		async submitResponse(input) {
			// Token-authenticated and deliberately identity-free: NO actor, NO
			// permission check. The conditional update is the whole gate.
			const tokenHash = await hashResponseToken(input.token);

			// One-submit gate: only proceeds if exactly one matching, not-yet-completed
			// assignment for THIS survey exists. RETURNING gives us the affected rows.
			const claimed = await db
				.update(surveyAssignments)
				.set({ completedAt: new Date() })
				.where(
					and(
						eq(surveyAssignments.surveyId, input.surveyId),
						eq(surveyAssignments.responseTokenHash, tokenHash),
						isNull(surveyAssignments.completedAt),
					),
				)
				.returning({ memberId: surveyAssignments.memberId });
			if (claimed.length !== 1) {
				throw new Error("This survey link is invalid or has already been used.");
			}

			// Validate every answer targets a real question on this survey before insert.
			const questions = await db
				.select({ id: surveyQuestions.id })
				.from(surveyQuestions)
				.where(eq(surveyQuestions.surveyId, input.surveyId));
			const questionIds = new Set(questions.map((q) => q.id));
			for (const answer of input.answers) {
				if (!questionIds.has(answer.questionId)) {
					throw new Error("Answer references an unknown question.");
				}
			}

			// The response row carries ONLY survey_id. Answers reference the response,
			// never the member. Written in one batch (single round trip).
			const responseId = createId("srvr");
			const answerRows = input.answers.map((answer) => ({
				id: createId("srva"),
				responseId,
				questionId: answer.questionId,
				value: answer.value,
			}));
			await db.batch([
				db.insert(surveyResponses).values({ id: responseId, surveyId: input.surveyId }),
				db.insert(surveyAnswers).values(answerRows),
			]);
			return { ok: true };
		},

		async getResults(actor, surveyId) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to read survey results.");

			const [survey] = await db.select().from(surveys).where(eq(surveys.id, surveyId)).limit(1);
			if (!survey) throw new Error("Survey not found.");

			const questions = await db
				.select()
				.from(surveyQuestions)
				.where(eq(surveyQuestions.surveyId, surveyId))
				.orderBy(asc(surveyQuestions.position));

			const assignments = await db
				.select({ completedAt: surveyAssignments.completedAt })
				.from(surveyAssignments)
				.where(eq(surveyAssignments.surveyId, surveyId));
			const assignedCount = assignments.length;
			const completedCount = assignments.filter((a) => a.completedAt !== null).length;

			// Join answers to questions through responses, by survey only. There is no
			// path here that could reach a member id, by construction.
			const answers = await db
				.select({ questionId: surveyAnswers.questionId, value: surveyAnswers.value })
				.from(surveyAnswers)
				.innerJoin(surveyResponses, eq(surveyResponses.id, surveyAnswers.responseId))
				.where(eq(surveyResponses.surveyId, surveyId));

			const resultQuestions: SurveyResultsQuestion[] = questions.map((question) => {
				const forQuestion = answers.filter((a) => a.questionId === question.id);
				if (question.type === "text") {
					return {
						questionId: question.id,
						prompt: question.prompt,
						type: question.type,
						answerCount: forQuestion.length,
						textAnswers: forQuestion.map((a) => a.value),
					};
				}
				const valueCounts: Record<string, number> = {};
				for (const answer of forQuestion) {
					valueCounts[answer.value] = (valueCounts[answer.value] ?? 0) + 1;
				}
				return {
					questionId: question.id,
					prompt: question.prompt,
					type: question.type,
					answerCount: forQuestion.length,
					valueCounts,
				};
			});

			return {
				surveyId,
				title: survey.title,
				status: survey.status,
				assignedCount,
				completedCount,
				questions: resultQuestions,
			};
		},
```

Now DELETE the `surveyQueryFragments` shim line at the bottom of the file (the `and`/`isNull` imports are now used by `submitResponse`). Add `createUnavailableSurveysRepository` from Step 1 at the bottom of the file.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- surveys.integration.test.ts`
Expected: PASS (all 9 cases green).

- [ ] **Step 6: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS, including `repositories/index.ts` now that the factory is called with `(db, audit)` and the shared builder uses the unavailable stub.

- [ ] **Step 7: Commit**

```bash
git add src/db/repositories/surveys.ts src/db/repositories/index.ts src/db/repositories/surveys.integration.test.ts
git commit -m "feat(surveys): anonymous token-gated submit and identity-free results

submitResponse takes no actor; a conditional UPDATE ... WHERE
response_token_hash = ? AND completed_at IS NULL gate enforces
one-submit. survey_responses carry only survey_id so there is no
join key back to a member."
```

---

### Task 6: Surveys contract — typed operations for the shared-dev internal API

**Files:**
- Create: `src/db/contract/surveys.ts`
- Modify: `src/db/contract/index.ts` (export the new contract)

**Interfaces:**
- Consumes: `operation` from `./common`; `createSurveyInputSchema`, `sampleSurveyInputSchema`, `submitSurveyResponseInputSchema` from `@/db/types`; `SurveyStatus` / `SurveyQuestionType` literal sets.
- Produces: `surveysContract` with `create`, `sample`, `list`, `get`, `submit`, `results` operations, each declaring `auth` / `permission` / `sharedDev`. Task 7 (internal handlers) consumes it.

- [ ] **Step 1: Create `src/db/contract/surveys.ts`**

```ts
import { z } from "zod";
import { createSurveyInputSchema, sampleSurveyInputSchema, submitSurveyResponseInputSchema } from "@/db/types";
import { operation } from "./common";

const surveyOutputSchema = z.object({
	id: z.string(),
	eventId: z.string().nullable(),
	title: z.string(),
	status: z.enum(["draft", "running", "closed"]),
	sampleSize: z.number().int().nullable(),
	createdBy: z.string(),
	createdAt: z.coerce.date(),
});

const surveyQuestionOutputSchema = z.object({
	id: z.string(),
	surveyId: z.string(),
	position: z.number().int(),
	type: z.enum(["scale", "text", "choice"]),
	prompt: z.string(),
	optionsJson: z.string().nullable(),
});

const surveyResultsSchema = z.object({
	surveyId: z.string(),
	title: z.string(),
	status: z.enum(["draft", "running", "closed"]),
	assignedCount: z.number().int(),
	completedCount: z.number().int(),
	questions: z.array(
		z.object({
			questionId: z.string(),
			prompt: z.string(),
			type: z.enum(["scale", "text", "choice"]),
			answerCount: z.number().int(),
			valueCounts: z.record(z.string(), z.number().int()).optional(),
			textAnswers: z.array(z.string()).optional(),
		}),
	),
});

export const surveysContract = {
	list: operation({
		input: z.object({ limit: z.number().int().min(1).max(50).default(25) }),
		output: z.object({ surveys: z.array(surveyOutputSchema) }),
		auth: "admin",
		permission: "survey:configure",
		sharedDev: "allow",
	}),
	get: operation({
		input: z.object({ id: z.string().min(1) }),
		output: z.object({
			survey: surveyOutputSchema.nullable(),
			questions: z.array(surveyQuestionOutputSchema),
		}),
		auth: "admin",
		permission: "survey:configure",
		sharedDev: "allow",
	}),
	create: operation({
		input: createSurveyInputSchema,
		output: z.object({ survey: surveyOutputSchema }),
		auth: "admin",
		permission: "survey:configure",
		sharedDev: "deny",
	}),
	sample: operation({
		input: sampleSurveyInputSchema,
		// Raw tokens are returned to the admin caller so they can be distributed;
		// they are never persisted server-side. Denied in shared dev.
		output: z.object({
			assigned: z.number().int(),
			tokens: z.array(z.object({ memberId: z.string(), token: z.string() })),
		}),
		auth: "admin",
		permission: "survey:configure",
		sharedDev: "deny",
	}),
	submit: operation({
		// Token-authenticated, identity-free: public auth, no permission.
		input: submitSurveyResponseInputSchema,
		output: z.object({ ok: z.literal(true) }),
		auth: "public",
		sharedDev: "deny",
	}),
	results: operation({
		input: z.object({ id: z.string().min(1) }),
		output: z.object({ results: surveyResultsSchema }),
		auth: "admin",
		permission: "survey:configure",
		sharedDev: "allow",
	}),
};
```

- [ ] **Step 2: Export it from `src/db/contract/index.ts`**

Add to `src/db/contract/index.ts`:
```ts
export { surveysContract } from "./surveys";
```

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. The contract is additive and consumed in Task 7.

- [ ] **Step 4: Commit**

```bash
git add src/db/contract/surveys.ts src/db/contract/index.ts
git commit -m "feat(surveys): typed internal contract for survey operations"
```

---

### Task 7: Internal survey handlers + route (shared-dev API)

**Files:**
- Create: `src/server/internal/surveys.ts`
- Create: `src/app/internal/surveys/route.ts`
- Create: `src/app/internal/surveys/[id]/route.ts`
- Create: `src/server/internal/surveys.integration.test.ts`

**Interfaces:**
- Consumes: `surveysContract` (Task 6); `createSurveysRepository` (Task 5); `createAuditRepository`; `resolveSharedActor`, `hashSharedToken` from `./shared-actor`; `getInternalCorsHeaders`, `splitAllowedOrigins` from `./cors`; `DeployEnv` from `@/server/env`.
- Produces: `createSurveysInternalHandlers({ db, deployEnv, allowedOrigins })` returning `{ fetch(request, surveyId?) }`, mirroring `createMembersInternalHandlers`. Routes delegate to it exactly like `src/app/internal/members/route.ts`.

- [ ] **Step 1: Write the failing integration test**

Create `src/server/internal/surveys.integration.test.ts`:
```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { hashSharedToken } from "./shared-actor";
import { createSurveysInternalHandlers } from "./surveys";

const ADMIN_TOKEN = "admin-token";

async function seedAdminToken() {
	await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
		.bind("mem_admin", "admin@example.com", "Admin", "active")
		.run();
	await env.DB.prepare("INSERT INTO roles (id, key, label, description, kind) VALUES (?, ?, ?, ?, ?)")
		.bind("role_super", "super", "Super", "All", "admin")
		.run();
	await env.DB.prepare("INSERT INTO member_roles (member_id, role_id, assigned_at) VALUES (?, ?, ?)")
		.bind("mem_admin", "role_super", Date.now())
		.run();
	await env.DB.prepare("INSERT INTO shared_dev_tokens (token_hash, member_id, label) VALUES (?, ?, ?)")
		.bind(await hashSharedToken(ADMIN_TOKEN), "mem_admin", "Admin token")
		.run();
}

function handlers() {
	return createSurveysInternalHandlers({ db: drizzle(env.DB, { schema }), deployEnv: "dev", allowedOrigins: [] });
}

describe("internal surveys handlers", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM survey_assignments").run();
		await env.DB.prepare("DELETE FROM survey_questions").run();
		await env.DB.prepare("DELETE FROM surveys").run();
		await env.DB.prepare("DELETE FROM member_roles").run();
		await env.DB.prepare("DELETE FROM shared_dev_tokens").run();
		await env.DB.prepare("DELETE FROM roles").run();
		await env.DB.prepare("DELETE FROM members").run();
		await seedAdminToken();
	});

	it("returns 404 when DEPLOY_ENV is not dev", async () => {
		const prod = createSurveysInternalHandlers({ db: drizzle(env.DB, { schema }), deployEnv: "prod" });
		const response = await prod.fetch(
			new Request("https://dev.example.com/internal/surveys", { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }),
		);
		expect(response.status).toBe(404);
	});

	it("rejects an invalid bearer token with 401", async () => {
		const response = await handlers().fetch(
			new Request("https://dev.example.com/internal/surveys", { headers: { Authorization: "Bearer nope" } }),
		);
		expect(response.status).toBe(401);
	});

	it("lists surveys for an authorized admin token", async () => {
		const response = await handlers().fetch(
			new Request("https://dev.example.com/internal/surveys", { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }),
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ surveys: [] });
	});

	it("denies create in shared dev with 403 even for an admin token", async () => {
		const response = await handlers().fetch(
			new Request("https://dev.example.com/internal/surveys", {
				method: "POST",
				headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
				body: JSON.stringify({ title: "X", questions: [{ type: "text", prompt: "Q" }] }),
			}),
		);
		expect(response.status).toBe(403);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- surveys.integration.test.ts`
Expected: FAIL — `./surveys` internal handler module does not exist. (Two test files now match `surveys.integration.test.ts`; run the suite and confirm the new internal file is the failing one.)

- [ ] **Step 3: Write `src/server/internal/surveys.ts`**

```ts
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { surveysContract } from "@/db/contract/surveys";
import { createAuditRepository } from "@/db/repositories/audit";
import { createSurveysRepository } from "@/db/repositories/surveys";
import type { DeployEnv } from "@/server/env";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type SurveysInternalDependencies = {
	db: DrizzleD1Database<typeof schema>;
	deployEnv: DeployEnv;
	allowedOrigins?: string[];
};

export function createSurveysInternalHandlers({ db, deployEnv, allowedOrigins = [] }: SurveysInternalDependencies) {
	const repository = createSurveysRepository(db, createAuditRepository(db));

	return {
		async fetch(request: Request, surveyId?: string): Promise<Response> {
			if (deployEnv !== "dev") return new Response("Not found", { status: 404 });

			const corsHeaders = getInternalCorsHeaders(request, allowedOrigins);
			if (request.method === "OPTIONS") {
				return new Response(null, { status: corsHeaders ? 204 : 403, headers: corsHeaders ?? undefined });
			}
			if (request.headers.has("origin") && !corsHeaders) {
				return Response.json({ error: "Origin is not allowed." }, { status: 403 });
			}
			const responseHeaders = corsHeaders ?? undefined;

			const actor = await resolveSharedActor(db, request);
			if (!actor) {
				return Response.json({ error: "Invalid shared development token." }, { status: 401, headers: responseHeaders });
			}

			try {
				if (request.method === "GET") {
					if (surveyId) {
						const input = surveysContract.get.input.parse({ id: surveyId });
						const detail = await repository.getById(actor, input.id);
						const output = surveysContract.get.output.parse({
							survey: detail?.survey ?? null,
							questions: detail?.questions ?? [],
						});
						return Response.json(output, { status: detail ? 200 : 404, headers: responseHeaders });
					}
					const url = new URL(request.url);
					const input = surveysContract.list.input.parse({
						limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
					});
					const surveys = await repository.list(actor, input);
					return Response.json(surveysContract.list.output.parse({ surveys }), { headers: responseHeaders });
				}

				if (request.method === "POST") {
					// create + sample are sharedDev: "deny"; both are refused over the proxy.
					if (surveysContract.create.sharedDev === "deny") {
						return Response.json(
							{ error: "Operation is disabled in shared development." },
							{ status: 403, headers: responseHeaders },
						);
					}
					const input = surveysContract.create.input.parse(await request.json());
					const survey = await repository.create(actor, input);
					return Response.json(surveysContract.create.output.parse({ survey }), {
						status: 201,
						headers: responseHeaders,
					});
				}

				return new Response("Method not allowed", { status: 405, headers: responseHeaders });
			} catch (error) {
				const message = error instanceof Error ? error.message : "Internal request failed.";
				const status = message.startsWith("Not authorized") ? 403 : 400;
				return Response.json({ error: message }, { status, headers: responseHeaders });
			}
		},
	};
}
```

- [ ] **Step 4: Write the two route files**

Create `src/app/internal/surveys/route.ts`:
```ts
import { getD1Db } from "@/db/client";
import { getAppConfig } from "@/server/env";
import { splitAllowedOrigins } from "@/server/internal/cors";
import { createSurveysInternalHandlers } from "@/server/internal/surveys";

function getHandlers() {
	const config = getAppConfig();
	return createSurveysInternalHandlers({
		db: getD1Db(),
		deployEnv: config.DEPLOY_ENV ?? "prod",
		allowedOrigins: splitAllowedOrigins(config.SHARED_API_ALLOWED_ORIGINS),
	});
}

export async function GET(request: Request) {
	return getHandlers().fetch(request);
}

export async function POST(request: Request) {
	return getHandlers().fetch(request);
}

export async function OPTIONS(request: Request) {
	return getHandlers().fetch(request);
}
```

Create `src/app/internal/surveys/[id]/route.ts`:
```ts
import { getD1Db } from "@/db/client";
import { getAppConfig } from "@/server/env";
import { splitAllowedOrigins } from "@/server/internal/cors";
import { createSurveysInternalHandlers } from "@/server/internal/surveys";

type SurveyRouteContext = {
	params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: SurveyRouteContext) {
	const config = getAppConfig();
	const { id } = await context.params;
	return createSurveysInternalHandlers({
		db: getD1Db(),
		deployEnv: config.DEPLOY_ENV ?? "prod",
		allowedOrigins: splitAllowedOrigins(config.SHARED_API_ALLOWED_ORIGINS),
	}).fetch(request, id);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- surveys.integration.test.ts`
Expected: PASS — both the repository and internal-handler survey suites green.

- [ ] **Step 6: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/internal/surveys.ts src/app/internal/surveys src/server/internal/surveys.integration.test.ts
git commit -m "feat(surveys): shared-dev internal API handlers and routes"
```

---

### Task 8: Admin survey UI — list, create, sample, results

**Files:**
- Create: `src/app/portal/admin/surveys/page.tsx`
- Create: `src/app/portal/admin/surveys/actions.ts`
- Create: `src/app/portal/admin/surveys/[id]/page.tsx`

**Interfaces:**
- Consumes: `getRepositories` from `@/db`; `requireActor`/`getActor` from `@/server/auth/actor`; `can` from `@/server/auth/permissions`; `createSurveyInputSchema`, `sampleSurveyInputSchema` from `@/db/types`; shadcn `Button`, `Card*`, `Input`, `Textarea`, `Select*`, `Badge`.
- Produces: the admin surveys surface at `/portal/admin/surveys` and the per-survey results page at `/portal/admin/surveys/[id]`, plus `createSurveyAction` and `sampleSurveyAction` server actions.

- [ ] **Step 1: Write the admin server actions**

Create `src/app/portal/admin/surveys/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getRepositories } from "@/db";
import { createSurveyInputSchema, sampleSurveyInputSchema } from "@/db/types";
import { requireActor } from "@/server/auth/actor";

export async function createSurveyAction(formData: FormData) {
	const actor = await requireActor();
	// One prompt per non-empty line; first form field picks the type uniformly.
	const prompts = String(formData.get("prompts") ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const type = String(formData.get("type") ?? "text") as "scale" | "text" | "choice";
	const input = createSurveyInputSchema.parse({
		title: formData.get("title"),
		eventId: nullableText(formData.get("eventId")),
		questions: prompts.map((prompt) => ({
			type,
			prompt,
			options: type === "scale" ? ["1", "2", "3", "4", "5"] : undefined,
		})),
	});
	const repositories = await getRepositories();
	const survey = await repositories.surveys.create(actor, input);
	revalidatePath("/portal/admin/surveys");
	redirect(`/portal/admin/surveys/${survey.id}`);
}

export async function sampleSurveyAction(formData: FormData) {
	const actor = await requireActor();
	const input = sampleSurveyInputSchema.parse({
		surveyId: formData.get("surveyId"),
		sampleSize: Number(formData.get("sampleSize")),
		seed: nullableText(formData.get("seed")) ?? undefined,
	});
	const repositories = await getRepositories();
	await repositories.surveys.sample(actor, input);
	revalidatePath(`/portal/admin/surveys/${input.surveyId}`);
}

function nullableText(value: FormDataEntryValue | null): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed || null;
}
```

- [ ] **Step 2: Write the admin list + create page**

Create `src/app/portal/admin/surveys/page.tsx`:
```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { createSurveyAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminSurveysPage() {
	const actor = await getActor();
	if (!actor) redirect("/signin");
	if (!can(actor, "survey:configure")) redirect("/portal");

	const repositories = await getRepositories();
	const surveys = await repositories.surveys.list(actor, { limit: 50 });

	return (
		<main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
			<div className="grid gap-6">
				<Card>
					<CardHeader>
						<CardTitle className="text-3xl">Surveys</CardTitle>
						<CardDescription>Create a survey, then draw a random sample to start collecting responses.</CardDescription>
					</CardHeader>
					<CardContent>
						<form action={createSurveyAction} className="grid gap-4">
							<label className="grid gap-2 text-sm font-medium">
								Title
								<Input name="title" required />
							</label>
							<label className="grid gap-2 text-sm font-medium">
								Question type
								<select className="h-9 rounded-md border border-input bg-background px-3 text-sm" name="type" defaultValue="text">
									<option value="text">Text</option>
									<option value="scale">Scale (1 to 5)</option>
									<option value="choice">Choice</option>
								</select>
							</label>
							<label className="grid gap-2 text-sm font-medium">
								Questions (one per line)
								<Textarea name="prompts" required rows={4} />
							</label>
							<div>
								<Button type="submit">
									<Plus />
									Create survey
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Existing surveys</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-3">
						{surveys.length === 0 ? (
							<p className="text-sm text-muted-foreground">No surveys yet.</p>
						) : (
							surveys.map((survey) => (
								<Link
									key={survey.id}
									href={`/portal/admin/surveys/${survey.id}`}
									className="flex items-center justify-between rounded-md border border-border px-4 py-3 text-sm hover:bg-accent"
								>
									<span className="font-medium">{survey.title}</span>
									<Badge variant="outline">{survey.status}</Badge>
								</Link>
							))
						)}
					</CardContent>
				</Card>
			</div>
		</main>
	);
}
```

- [ ] **Step 3: Write the per-survey detail + results page**

Create `src/app/portal/admin/surveys/[id]/page.tsx`:
```tsx
import { notFound, redirect } from "next/navigation";
import { Shuffle } from "lucide-react";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { sampleSurveyAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function AdminSurveyDetailPage({ params }: { params: Promise<{ id: string }> }) {
	const actor = await getActor();
	if (!actor) redirect("/signin");
	if (!can(actor, "survey:configure")) redirect("/portal");

	const { id } = await params;
	const repositories = await getRepositories();
	const detail = await repositories.surveys.getById(actor, id);
	if (!detail) notFound();
	const results = await repositories.surveys.getResults(actor, id);

	return (
		<main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
			<div className="grid gap-6">
				<Card>
					<CardHeader>
						<CardTitle className="text-3xl">{detail.survey.title}</CardTitle>
						<CardDescription>
							<Badge variant="outline">{detail.survey.status}</Badge> {results.completedCount} of {results.assignedCount}{" "}
							assigned members responded.
						</CardDescription>
					</CardHeader>
					{detail.survey.status === "draft" ? (
						<CardContent>
							<form action={sampleSurveyAction} className="flex flex-wrap items-end gap-3">
								<input type="hidden" name="surveyId" value={detail.survey.id} />
								<label className="grid gap-2 text-sm font-medium">
									Sample size
									<Input name="sampleSize" type="number" min={1} defaultValue={10} className="w-32" />
								</label>
								<label className="grid gap-2 text-sm font-medium">
									Seed (optional)
									<Input name="seed" className="w-48" />
								</label>
								<Button type="submit">
									<Shuffle />
									Draw sample and start
								</Button>
							</form>
						</CardContent>
					) : null}
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Results</CardTitle>
						<CardDescription>Aggregated and anonymous. Responses cannot be traced to any member.</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-5">
						{results.questions.map((question) => (
							<div key={question.questionId} className="grid gap-2">
								<p className="font-medium">{question.prompt}</p>
								{question.textAnswers ? (
									<ul className="grid gap-1 text-sm text-muted-foreground">
										{question.textAnswers.length === 0 ? (
											<li>No answers yet.</li>
										) : (
											question.textAnswers.map((answer, index) => <li key={index}>{answer}</li>)
										)}
									</ul>
								) : (
									<ul className="grid gap-1 text-sm text-muted-foreground">
										{Object.entries(question.valueCounts ?? {}).length === 0 ? (
											<li>No answers yet.</li>
										) : (
											Object.entries(question.valueCounts ?? {}).map(([value, count]) => (
												<li key={value}>
													{value}: {count}
												</li>
											))
										)}
									</ul>
								)}
							</div>
						))}
					</CardContent>
				</Card>
			</div>
		</main>
	);
}
```

- [ ] **Step 4: Run typecheck, lint, and build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS. (If `pnpm build` fails only because OpenNext needs Cloudflare context that is absent locally, capture the exact error and confirm it is environmental, not a type/route error, before proceeding.)

- [ ] **Step 5: Commit**

```bash
git add src/app/portal/admin/surveys
git commit -m "feat(surveys): admin list, create, sample, and identity-free results UI"
```

---

### Task 9: Member response flow — page, server action, /api submit handler

**Files:**
- Create: `src/app/portal/surveys/[id]/page.tsx`
- Create: `src/app/portal/surveys/[id]/actions.ts`
- Create: `src/app/api/surveys/submit/route.ts`
- Create: `src/app/api/surveys/submit/route.integration.test.ts`

**Interfaces:**
- Consumes: `submitSurveyResponseInputSchema` from `@/db/types`; `getRepositories` from `@/db`; `getActor` from `@/server/auth/actor`; `assertSameOrigin` from `@/server/http/origin`; `getAppConfig` from `@/server/env`.
- Produces: the member-facing survey page at `/portal/surveys/[id]` that reads the assignment token from the `?t=` query string, a `submitResponseAction` server action, and a same-origin-guarded `POST /api/surveys/submit`. This closes the member response loop end to end.

- [ ] **Step 1: Write the failing /api submit route test**

Create `src/app/api/surveys/submit/route.integration.test.ts`:
```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createAuditRepository } from "@/db/repositories/audit";
import { createSurveysRepository } from "@/db/repositories/surveys";
import type { Actor } from "@/server/auth/permissions";
import { POST } from "./route";

const admin: Actor = { memberId: "mem_admin", roles: ["super"] };
const ORIGIN = "https://portal.example.com";

async function setupRunningSurvey() {
	await env.DB.prepare("DELETE FROM survey_answers").run();
	await env.DB.prepare("DELETE FROM survey_responses").run();
	await env.DB.prepare("DELETE FROM survey_assignments").run();
	await env.DB.prepare("DELETE FROM survey_questions").run();
	await env.DB.prepare("DELETE FROM surveys").run();
	await env.DB.prepare("DELETE FROM members").run();
	for (let i = 0; i < 3; i += 1) {
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind(`mem_${i}`, `m${i}@example.com`, `M${i}`, "active")
			.run();
	}
	const db = drizzle(env.DB, { schema });
	const repo = createSurveysRepository(db, createAuditRepository(db));
	const survey = await repo.create(admin, { title: "S", questions: [{ type: "text", prompt: "Q" }] });
	const detail = await repo.getById(admin, survey.id);
	const { tokens } = await repo.sample(admin, { surveyId: survey.id, sampleSize: 1, seed: "x" });
	return { surveyId: survey.id, questionId: detail!.questions[0].id, token: tokens[0].token };
}

describe("POST /api/surveys/submit", () => {
	beforeEach(async () => {
		await setupRunningSurvey();
	});

	it("rejects a cross-origin submit", async () => {
		const { surveyId, questionId, token } = await setupRunningSurvey();
		const request = new Request(`${ORIGIN}/api/surveys/submit`, {
			method: "POST",
			headers: { origin: "https://evil.example.com", "content-type": "application/json" },
			body: JSON.stringify({ surveyId, token, answers: [{ questionId, value: "hi" }] }),
		});
		const response = await POST(request);
		expect(response.status).toBe(403);
	});

	it("accepts a same-origin submit with a valid token, then rejects reuse", async () => {
		const { surveyId, questionId, token } = await setupRunningSurvey();
		const makeRequest = () =>
			new Request(`${ORIGIN}/api/surveys/submit`, {
				method: "POST",
				headers: { origin: ORIGIN, "content-type": "application/json" },
				body: JSON.stringify({ surveyId, token, answers: [{ questionId, value: "hi" }] }),
			});
		await expect(POST(makeRequest()).then((r) => r.status)).resolves.toBe(200);
		await expect(POST(makeRequest()).then((r) => r.status)).resolves.toBe(400);
	});
});
```

Note: `assertSameOrigin` derives the expected origin from `request.url` when no base URL is passed, so the test's request URL origin must match the `origin` header for the success case. The route passes `getAppConfig().APP_BASE_URL` if set; the test leaves it unset so the request-url origin is used. If the test worker sets `APP_BASE_URL`, align `ORIGIN` to it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- route.integration.test.ts`
Expected: FAIL — `./route` does not exist yet.

- [ ] **Step 3: Write the /api submit route**

Create `src/app/api/surveys/submit/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getRepositories } from "@/db";
import { submitSurveyResponseInputSchema } from "@/db/types";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";

export async function POST(request: Request) {
	try {
		assertSameOrigin(request, getAppConfig().APP_BASE_URL);
	} catch {
		return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}

	let input;
	try {
		input = submitSurveyResponseInputSchema.parse(await request.json());
	} catch {
		return NextResponse.json({ error: "Invalid submission." }, { status: 400 });
	}

	try {
		const repositories = await getRepositories();
		await repositories.surveys.submitResponse(input);
		return NextResponse.json({ ok: true });
	} catch (error) {
		// Token invalid / already used / unknown question all surface as 400 with no
		// member-identifying detail, preserving anonymity.
		const message = error instanceof Error ? error.message : "Submission failed.";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
```

Confirm `APP_BASE_URL` exists on the config returned by `getAppConfig()`. If the env schema names it `AUTH_URL` instead, use that key; check `src/server/env.ts` and use whichever base-URL field is defined (do not add a new env var). If neither is set in a given environment, `assertSameOrigin(request)` with no second argument (request-url origin) is the correct fallback.

- [ ] **Step 4: Write the member response server action**

Create `src/app/portal/surveys/[id]/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { submitSurveyResponseInputSchema } from "@/db/types";

export async function submitResponseAction(formData: FormData) {
	const surveyId = String(formData.get("surveyId") ?? "");
	const token = String(formData.get("token") ?? "");
	// Every form field named q:<questionId> becomes one answer.
	const answers: Array<{ questionId: string; value: string }> = [];
	for (const [key, value] of formData.entries()) {
		if (key.startsWith("q:") && typeof value === "string" && value.trim()) {
			answers.push({ questionId: key.slice(2), value: value.trim() });
		}
	}
	const input = submitSurveyResponseInputSchema.parse({ surveyId, token, answers });
	const repositories = await getRepositories();
	await repositories.surveys.submitResponse(input);
	redirect(`/portal/surveys/${surveyId}?done=1`);
}
```

- [ ] **Step 5: Write the member response page**

Create `src/app/portal/surveys/[id]/page.tsx`:
```tsx
import { notFound, redirect } from "next/navigation";
import { Send } from "lucide-react";
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getActor } from "@/server/auth/actor";
import { submitResponseAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function MemberSurveyPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ t?: string; done?: string }>;
}) {
	const actor = await getActor();
	if (!actor) redirect("/signin");

	const { id } = await params;
	const { t: token, done } = await searchParams;

	const repositories = await getRepositories();
	// getById requires survey:configure, so members read questions through the
	// actor-checked admin path only if they hold it; for a plain member we still
	// need the prompts. The survey is fetched with the member actor and the page
	// shows prompts; the token gates submission, not reading.
	const detail = await repositories.surveys.getById(actor, id).catch(() => null);
	if (!detail) notFound();

	if (done) {
		return (
			<main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
				<Card>
					<CardHeader>
						<CardTitle className="text-2xl">Thank you</CardTitle>
						<CardDescription>Your response was recorded anonymously.</CardDescription>
					</CardHeader>
				</Card>
			</main>
		);
	}

	return (
		<main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
			<Card>
				<CardHeader>
					<CardTitle className="text-2xl">{detail.survey.title}</CardTitle>
					<CardDescription>Your answers are anonymous. They cannot be traced back to you.</CardDescription>
				</CardHeader>
				<CardContent>
					{!token ? (
						<p className="text-sm text-muted-foreground">This survey link is missing its access token.</p>
					) : (
						<form action={submitResponseAction} className="grid gap-5">
							<input type="hidden" name="surveyId" value={detail.survey.id} />
							<input type="hidden" name="token" value={token} />
							{detail.questions.map((question) => (
								<label key={question.id} className="grid gap-2 text-sm font-medium">
									{question.prompt}
									{question.type === "text" ? (
										<Textarea name={`q:${question.id}`} rows={3} />
									) : (
										<Input name={`q:${question.id}`} />
									)}
								</label>
							))}
							<div>
								<Button type="submit">
									<Send />
									Submit response
								</Button>
							</div>
						</form>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
```

Note on reading prompts as a plain member: `getById` currently requires `survey:configure`. The member page must still render prompts for an assigned non-admin member. Resolve this in Step 6 by adding a narrow, read-only `getForRespondent(surveyId)` to the repository that returns ONLY `{ survey: {id,title,status}, questions }` with NO actor gate (prompts are not sensitive; the token gates submission), and have the member page call THAT instead of `getById`. Do not loosen `getById`.

- [ ] **Step 6: Add `getForRespondent` to the surveys repository and switch the member page to it**

In `src/db/repositories/surveys.ts`, add to the `SurveysRepository` type:
```ts
	getForRespondent(surveyId: string): Promise<{ survey: Survey; questions: SurveyQuestion[] } | null>;
```
and implement it (no actor, no permission, prompts are public to any signed-in member):
```ts
		async getForRespondent(surveyId) {
			const [survey] = await db.select().from(surveys).where(eq(surveys.id, surveyId)).limit(1);
			if (!survey) return null;
			const questions = await db
				.select()
				.from(surveyQuestions)
				.where(eq(surveyQuestions.surveyId, surveyId))
				.orderBy(asc(surveyQuestions.position));
			return { survey, questions };
		},
```
Add `getForRespondent: unavailable` to `createUnavailableSurveysRepository`. Then in `src/app/portal/surveys/[id]/page.tsx` replace `repositories.surveys.getById(actor, id).catch(() => null)` with `repositories.surveys.getForRespondent(id)`.

- [ ] **Step 7: Run the route test to verify it passes**

Run: `pnpm test -- route.integration.test.ts`
Expected: PASS (cross-origin rejected; same-origin valid token accepted once then rejected on reuse).

- [ ] **Step 8: Run the full survey suite, typecheck, lint, build**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS (sample, survey-token, surveys repository, internal surveys, api submit route suites all green; existing suites unaffected). Treat an environmental-only OpenNext `build` failure as in Task 8 Step 4.

- [ ] **Step 9: Commit**

```bash
git add src/app/portal/surveys src/app/api/surveys src/db/repositories/surveys.ts
git commit -m "feat(surveys): member anonymous response page, action, and same-origin submit API"
```

---

### Task 10: Seed a running survey end to end, refresh graph, surface dev-Worker redeploy

**Files:**
- Modify: `src/db/seed/data.ts` (extend the existing `seedSurveyAssignments` comment + ensure a usable demo token hash; optionally add a second assignment)
- Verify only: `src/db/seed/run.ts` (survey rows already inserted by the existing `seedLocal()` sequence)

**Interfaces:**
- Consumes: `hashResponseToken` (Task 3) only if regenerating the demo assignment hash; otherwise none.
- Produces: a seeded demo survey whose assignment token hash corresponds to a known raw token, so a developer can open `/portal/surveys/srv_demo?t=<known-token>` locally and submit once. No schema or contract change.

- [ ] **Step 1: Make the demo assignment token reproducible**

The existing seed (`src/db/seed/data.ts`) already inserts `srv_demo`, `srvq_demo_1`, and one `surveyAssignments` row with `responseTokenHash: "demo-response-token-hash"`. That literal hash does not correspond to any real token, so the demo response flow cannot be exercised. Replace the `seedSurveyAssignments` definition with a precomputed SHA-256 of a fixed demo token so the flow is walkable. Compute the hash once and inline it (do not import runtime hashing into seed data, which runs under tsx/node):

Run this one-off to get the hash for the demo token `demo-survey-token`:
```bash
node -e "const c=require('crypto');console.log(c.createHash('sha256').update('demo-survey-token').digest('hex'))"
```
Then set:
```ts
export const seedSurveyAssignments: InferInsertModel<typeof surveyAssignments>[] = [
	// Raw token for local walkthrough: "demo-survey-token" (open
	// /portal/surveys/srv_demo?t=demo-survey-token). Only the hash is stored.
	{ surveyId: "srv_demo", memberId: "mem_demo_member", responseTokenHash: "<PASTE_HASH_HERE>" },
];
```
Paste the exact 64-char hex digest printed by the command above into `<PASTE_HASH_HERE>`.

- [ ] **Step 2: Confirm the seed still type-checks and the insert order is intact**

Run: `pnpm typecheck`
Expected: PASS. `seed/run.ts`'s `seedLocal()` already inserts `surveys` -> `surveyQuestions` -> `surveyAssignments` in FK-safe order; no change needed there.

- [ ] **Step 3: STOP — show the exact local seed command and wait for approval**

Per CLAUDE.md, do not run a seed without explicit approval. Present and wait:
```bash
pnpm db:seed:local
```
This loads the demo seed (including the walkable survey assignment) into the local better-sqlite3 database only. It does not touch dev or prod D1.

- [ ] **Step 4: After approval, run it and verify**

Run: `pnpm db:seed:local`
Expected: completes with no error (insert-or-ignore is idempotent).

- [ ] **Step 5: Refresh the knowledge graph**

Run: `graphify update .`
Expected: AST-only update, no API cost, completes cleanly. This keeps `graphify-out/` current with the new survey repository, contract, internal handlers, and routes per CLAUDE.md.

- [ ] **Step 6: Commit**

```bash
git add src/db/seed/data.ts graphify-out
git commit -m "chore(surveys): seed a walkable demo survey assignment, refresh graph"
```

- [ ] **Step 7: STOP — surface the dev-Worker redeploy obligation, do not run it without approval**

Per CLAUDE.md and master-plan §15, this phase changed the internal contract (`src/db/contract/surveys.ts`) and added `/internal/surveys/*`, so shared-mode developers break until the dev Worker is redeployed. Present these commands to the user and wait for explicit approval before running either:
```bash
pnpm db:migrate:dev
pnpm deploy:dev
```
Note: no schema changed this phase, so `db:migrate:dev` is a no-op safety run; `deploy:dev` is the load-bearing step (it ships the new `/internal/surveys` routes + contract to the dev Worker). State this explicitly when asking for approval.

---

## Self-review notes (for the implementer, not a step to execute)

- **Spec coverage (master plan §1, §6 surveys, §8, §11 #5, Phase 6):**
  - "create" -> Task 4 `surveys.create` + Task 8 admin create UI.
  - "random sample + tokens" -> Task 2 `seededSample` + Task 3 token generate/hash + Task 4 `surveys.sample` (stores only hashes, returns raw tokens to the admin, flips draft->running) + Task 8 sample UI.
  - "anonymous response flow" -> Task 5 `submitResponse` (conditional-update one-submit gate, `db.batch()` insert, responses carry only `survey_id`) + Task 9 member page/action + same-origin `/api/surveys/submit`.
  - "admin results (identity-free)" -> Task 5 `getResults` (joins answers to questions through responses by survey only; no member-reachable path) + Task 8 results UI.
  - "No auto-trigger on event close" -> honored: nothing in any task hooks event close; surveys are manual; an `event_id` may be set but never drives creation (Global Constraints + Task 4 `create` accepts optional `eventId` only).
  - Shared-dev internal API parity (§3.3) -> Task 6 contract + Task 7 handlers/routes, with `create`/`sample`/`submit` as `sharedDev: "deny"` and `list`/`get`/`results` as `"allow"`, mirroring the members pattern.
  - Deterministic sampling unit test (§8) -> Task 2.
  - Authz in repositories + audit on writes (§5, §6) -> every privileged method calls `can(actor, "survey:configure")`; `create` and `sample` call `audit.record(..., category: "survey")`.
  - D1 budget (§3.4) -> assignment inserts chunked at 33 rows/statement; `list` uses `pageLimit`; every survey query hits an existing index.
- **Placeholder scan:** the only intentional fill-in is Task 10 Step 1's `<PASTE_HASH_HERE>`, which is produced by the exact `node -e` command shown one line above it (a real computed value, not a TODO). Every code step contains complete code.
- **Type consistency:** `createSurveysRepository(db, audit)` signature is identical in Tasks 4, 5, 7, and both `index.ts` call sites. `SurveysRepository` gains methods additively across Tasks 4 (`create`/`sample`/`list`/`getById`), 5 (`submitResponse`/`getResults`/`createUnavailableSurveysRepository`), and 9 (`getForRespondent`); the unavailable stub is updated in lockstep each time it gains a method. `submitResponse` deliberately takes NO actor in the type, the repository, the contract (`auth: "public"`), and the `/api` route. Contract input schemas (`createSurveyInputSchema`, `sampleSurveyInputSchema`, `submitSurveyResponseInputSchema`) are the same symbols defined in Task 1 and reused in Tasks 6, 8, 9.
- **Not in scope (other phases per master-plan §12):** member-facing survey notifications / unread badges derive from `survey_assignments` + `member_feed_state` and belong to Phase 2 (notifications) and Phase 7 (notification derive on assign); they are not built here. The portal nav entry linking to `/portal/admin/surveys` and `/portal/surveys/[id]` is part of the Phase 2 portal shell / Phase 8 admin nav, not this phase. Closing a survey (`status: "closed"`) is not required by the Phase 6 line item; if desired it is a trivial later addition (an admin `close` op mirroring `sample`), explicitly deferred to keep this phase to the stated scope.
- **Schema untouched:** confirmed the five survey tables and their indexes already exist (`src/db/schema.ts` L318-L386); this plan adds no table, column, or migration, so there is no `db:generate`/`db:migrate` for schema in this phase (only the optional no-op `db:migrate:dev` safety run in Task 10 Step 7).

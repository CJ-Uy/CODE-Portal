# Email System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an internal email system to beta. Email admins compose block-based CODE emails and send them, bulk or targeted, to members through Cloudflare Email Service. Member replies land in a portal inbox. Members get an archive and per-category opt-outs.

**Architecture:** One D1 outbox (`email_deliveries`) is drained by a 1-minute cron in a custom Worker entry that wraps the OpenNext worker. The same entry adds an `email` handler for inbound replies. Replies are threaded by plus-addressed Reply-To (`beta-inbox+<id>@ateneocode.org`). Rendering is a pure function shared by the server (sending) and the client (live preview). Every admin surface sits behind `FEATURE_EMAIL` and the new `email` role.

**Tech Stack:** Next.js 16 (App Router, server actions), OpenNext Cloudflare, D1 + Drizzle 0.45, zod 4, Tailwind 4 + local shadcn primitives, Cloudflare Email Service (`send_email` binding, Email Routing), `postal-mime`, Workers `HTMLRewriter`, vitest Workers pool.

**Spec:** `docs/superpowers/specs/2026-10-02-email-system-design.md`

## Global Constraints

- Beta only. Only `wrangler.beta.jsonc` changes. `wrangler.jsonc` and `wrangler.staging.jsonc` stay untouched. Never run staging or prod migrations or deploys.
- `src/db/schema.ts` is the only schema source. One new migration on `drizzle/migrations` (next number `0007`), generated with `pnpm db:generate`, plus hand-written seed lines appended.
- Show the exact `pnpm exec wrangler` / `pnpm db:migrate:dev` command and wait for approval before any D1 migration, secret, or deploy (CLAUDE.md).
- Tests run in the Workers vitest pool: `.ts` files only, no jsdom, no React render tests, no `better-sqlite3` imports in tests.
- Feature flag `FEATURE_EMAIL` fails closed (only the literal `"true"` enables it).
- Permissions: `email:send` (compose, test, send, schedule, cancel, reports, inbox) and `email:configure` (templates, categories, senders). `super` inherits both. Every server action checks permission in the repository, not only in the page.
- Sender addresses must end in `@ateneocode.org`.
- Merge tags: exactly `first_name`, `full_name`, `nickname`, `batch`, `email`. Syntax `{{tag}}`. Unknown tags are rejected on save.
- Brand colors only: navy `#06192F`, blue `#0C315C`, light blue `#D7DFE9`, dark gray `#121315`, pale blue `#90B4CC`, supporting `#4986AC`, `#3D5266`, `#343B41`, `#717D89`, `#AAAFB5`. No free color picker.
- Copy: plain and specific. No em dashes, no curly quotes, no promotional filler (design.md writing rules).
- New dependency allowed: `postal-mime` only. No drag, animation, toast, or dialog libraries. Use native `<dialog>`, native drag events, CSS transitions.
- All motion respects `prefers-reduced-motion`.
- User-controlled labels in flex rows use `min-w-0` plus `break-all` (not `break-words`) to avoid mobile overflow.
- Commits: plain messages, no `Co-Authored-By` or AI trailers.

## Review Focus

1. **Inactive members.** An audience rule like "Current roster" can match a member whose status is `inactive`. Expect them to be excluded unless the audience has an explicit `status: inactive` rule or the member is hand-picked. Pinned in Task 6.
2. **Double "Send" click or editing mid-send.** A second `schedule` on an already scheduled campaign, or `saveDraft` on a `sending`/`sent` campaign, must be refused without changing state. Pinned in Task 8.
3. **Category flipped to Required after opt-outs exist.** Members who opted out earlier must still receive the email. Required ignores opt-outs. Pinned in Task 9.
4. **Reply without the plus tag, or from a non-member address.** Some clients strip `+tag`, and people forward replies from other accounts. Expect a new open thread, never a crash or a dropped message. Pinned in Task 10.
5. **Stale unsubscribe link.** A token for a category that was later archived or made Required. Expect a neutral "not valid for this category" result and no opt-out row. Pinned in Task 11.

## Spec deviations (decided during planning)

- **Threading key.** Cloudflare Email Service does not let us set `Message-ID`: it is platform-controlled. Replies are therefore threaded by plus-addressed `Reply-To`: `beta-inbox+edl_<deliveryId>@` for sends and `beta-inbox+eth_<threadId>@` for inbox replies. The user must enable **Subaddressing** in Email Routing settings. `In-Reply-To`/`References` matching against stored inbound Message-IDs stays as a fallback.
- **`skipped_no_email` dropped.** `members.email` is `NOT NULL`, so that status cannot occur.
- **Footer unsubscribe link opens a confirm page.** Link scanners prefetch GET URLs, so a GET request never writes an opt-out. The `List-Unsubscribe` header uses RFC 8058 one-click POST, which Gmail and Yahoo show as a native button.
- **Cancel split in two.** `unschedule` returns a scheduled campaign to draft; this is also the 2-minute undo. `cancel` stops a sending campaign.
- **Image block takes an HTTPS URL.** Uploading images is out of v1, because the uploads API is scoped to events and links.

## File Map

Server and library (tested):

| File | Responsibility |
|---|---|
| `src/server/auth/permissions.ts` (modify) | `email` role, `email:send`, `email:configure` |
| `src/server/features.ts`, `src/server/env.ts` (modify) | `email` feature flag |
| `src/server/email/config.ts` | Parse `EMAIL_*` env, `plusAddress`, `plusTag`, `SENDING_DOMAIN` |
| `src/lib/email/types.ts` | `EmailBlock`, `Audience`, `AudienceRule` types |
| `src/lib/email/blocks.ts` | zod schemas for blocks and audiences |
| `src/lib/email/merge.ts` | Merge tags, unknown-tag detection, member merge values |
| `src/lib/email/render.ts` | Pure renderer: blocks to email HTML and text, per-block HTML for the editor |
| `src/lib/email/action-result.ts` | `ActionResult<T>` and `runAction` for server actions |
| `src/server/email/unsubscribe-token.ts` | HMAC sign and verify |
| `src/server/email/sender.ts` | `EmailSender` seam over `env.EMAIL.send`, `EmailQuotaError` |
| `src/server/email/dispatch.ts` | Cron dispatcher: claim, enqueue, drain, finish |
| `src/server/email/sanitize.ts` | Inbound HTML sanitizer on `HTMLRewriter` |
| `src/server/email/inbound.ts` | Inbound handler: R2 raw, parse, thread, store |
| `src/db/schema.ts` (modify) | 8 new tables |
| `src/db/repositories/email-audience.ts` | Audience resolution and preview |
| `src/db/repositories/email-settings.ts` | Senders and categories |
| `src/db/repositories/email-templates.ts` | Templates |
| `src/db/repositories/email-campaigns.ts` | Drafts, schedule, cancel, retry, report, home |
| `src/db/repositories/email-inbox.ts` | Threads, reply, assign, status |
| `src/db/repositories/email-member.ts` | Archive, reader, preferences, token opt-out |
| `src/db/repositories/email.ts` | Aggregates the five repositories |
| `custom-worker.ts` | Worker entry: OpenNext `fetch` + `scheduled` + `email` |

UI (verified by typecheck, lint, and browser on beta):

| File | Responsibility |
|---|---|
| `src/components/ui/toast.tsx` | Toast provider with undo action |
| `src/app/globals.css` (modify) | Motion keyframes and reduced-motion fallbacks |
| `src/components/email/status-pill.tsx` | Campaign and delivery status pills |
| `src/components/email/send-progress.tsx` | Stacked bar, live polling while sending |
| `src/components/email/email-canvas.tsx` | Renders blocks with header and footer at 600 or 375 px |
| `src/components/email/block-editor.tsx` | Palette, canvas, inspector, reorder, undo/redo, merge tag menu |
| `src/components/email/audience-picker.tsx` | Token field, match toggle, exclude, live count card |
| `src/components/email/composer.tsx` | Checklist composer, autosave, test send, review dialog |
| `src/app/portal/admin/email/**` | Home, new, sends, templates, inbox, settings pages and actions |
| `src/app/portal/mail/**` | Member archive, reader, preferences |
| `src/app/unsubscribe/**`, `src/app/api/email/unsubscribe/route.ts` | Public unsubscribe |

---

### Task 1: Role, permissions, feature flag, email config

**Files:**
- Modify: `src/server/auth/permissions.ts`
- Modify: `src/server/features.ts`
- Modify: `src/server/env.ts`
- Modify: `src/db/repositories/audit.ts:22-30`
- Modify: `src/app/portal/admin/system/audit/page.tsx:15` (the `CATEGORIES` array)
- Modify: `src/db/seed/data.ts:38` (roles seed list)
- Modify: `vitest.config.mts` (bindings)
- Create: `src/server/email/config.ts`
- Test: `src/server/auth/permissions.email.test.ts`
- Test: `src/server/email/config.test.ts`

**Interfaces:**
- Produces: `RoleKey` includes `"email"`. `PermissionAction` includes `"email:send" | "email:configure"`. `FeatureKey` includes `"email"`. `AuditCategory` includes `"email"`.
- Produces: `type EmailConfig = { inboxAddress: string; publicBaseUrl: string; unsubscribeSecret: string; batchPerTick: number; dailyCap: number }`, `emailConfigFrom(env: Record<string, unknown>): EmailConfig`, `plusAddress(inbox: string, tag: string): string`, `plusTag(address: string): string | null`, `SENDING_DOMAIN = "ateneocode.org"`, `isSendingAddress(address: string): boolean`.

- [ ] **Step 1: Write the failing tests**

`src/server/auth/permissions.email.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { can, normalizeRoleKey, type Actor } from "./permissions";

describe("email permissions", () => {
	it("grants the email role both email actions and nothing else", () => {
		const actor: Actor = { memberId: "mem_e", roles: ["email"] };
		expect(can(actor, "email:send")).toBe(true);
		expect(can(actor, "email:configure")).toBe(true);
		expect(can(actor, "announcement:manage")).toBe(false);
		expect(can(actor, "role:assign")).toBe(false);
	});

	it("lets super send and configure, and refuses plain members", () => {
		expect(can({ memberId: "mem_s", roles: ["super"] }, "email:configure")).toBe(true);
		expect(can({ memberId: "mem_m", roles: ["member"] }, "email:send")).toBe(false);
		expect(can({ memberId: "mem_p", roles: ["publishing"] }, "email:send")).toBe(false);
	});

	it("recognises email as a role key", () => {
		expect(normalizeRoleKey("email")).toBe("email");
	});
});
```

`src/server/email/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emailConfigFrom, isSendingAddress, plusAddress, plusTag } from "./config";

const base = {
	EMAIL_INBOX_ADDRESS: "Beta-Inbox@ateneocode.org",
	EMAIL_PUBLIC_BASE_URL: "https://beta.ateneocode.org/",
	EMAIL_UNSUBSCRIBE_SECRET: "0123456789abcdef0123",
};

describe("emailConfigFrom", () => {
	it("normalises the inbox and base URL and applies defaults", () => {
		expect(emailConfigFrom(base)).toEqual({
			inboxAddress: "beta-inbox@ateneocode.org",
			publicBaseUrl: "https://beta.ateneocode.org",
			unsubscribeSecret: "0123456789abcdef0123",
			batchPerTick: 25,
			dailyCap: 300,
		});
	});

	it("reads numeric overrides from strings", () => {
		const config = emailConfigFrom({ ...base, EMAIL_BATCH_PER_TICK: "10", EMAIL_DAILY_CAP: "50" });
		expect(config.batchPerTick).toBe(10);
		expect(config.dailyCap).toBe(50);
	});

	it("refuses a short secret", () => {
		expect(() => emailConfigFrom({ ...base, EMAIL_UNSUBSCRIBE_SECRET: "short" })).toThrow();
	});
});

describe("plus addressing", () => {
	it("adds and reads a tag", () => {
		const address = plusAddress("beta-inbox@ateneocode.org", "edl_abc123");
		expect(address).toBe("beta-inbox+edl_abc123@ateneocode.org");
		expect(plusTag(address)).toBe("edl_abc123");
		expect(plusTag("Beta-Inbox+EDL_ABC@ateneocode.org")).toBe("edl_abc");
	});

	it("returns null without a tag", () => {
		expect(plusTag("beta-inbox@ateneocode.org")).toBeNull();
	});
});

describe("isSendingAddress", () => {
	it("accepts only the CODE domain", () => {
		expect(isSendingAddress("events@ateneocode.org")).toBe(true);
		expect(isSendingAddress("events@ateneocode.org.evil.com")).toBe(false);
		expect(isSendingAddress("someone@gmail.com")).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/server/auth/permissions.email.test.ts src/server/email/config.test.ts`
Expected: FAIL. `config.ts` does not exist, and `"email"` is not a `RoleKey`.

- [ ] **Step 3: Implement**

`src/server/auth/permissions.ts`:
- Change line 1 to:
  ```ts
  export const roleKeys = ["super", "member", "events", "link", "retention", "member_admin", "publishing", "email"] as const;
  ```
- Append `"email:send",` and `"email:configure",` to the end of `permissionActions` (after `"library:moderate"`).
- Add to `rolePermissions`:
  ```ts
  	email: ["email:send", "email:configure"],
  ```

`src/server/features.ts`:
- Add `"email",` to the end of `FEATURE_KEYS`.
- In `featureFlagsFromConfig`, add `email: config.FEATURE_EMAIL,`.

`src/server/env.ts`:
- In `rawEnvSchema` after `FEATURE_PUBLIC_SITE: featureFlagSchema,` add `FEATURE_EMAIL: featureFlagSchema,`.
- In `getAppConfig()` add `FEATURE_EMAIL: runtimeEnvValue("FEATURE_EMAIL"),` next to the other feature lines.

`src/db/repositories/audit.ts`: add `| "email"` to `AuditCategory`.

`src/app/portal/admin/system/audit/page.tsx`: add `"email"` to the `CATEGORIES` array.

`src/db/seed/data.ts`: after the `role_publishing` line add:

```ts
	{ id: "role_email", key: "email", label: "Email", description: "Sends member emails and manages templates, categories, and the reply inbox.", kind: "admin" },
```

`vitest.config.mts` bindings: after `FEATURE_PUBLIC_SITE: "true",` add:

```ts
					FEATURE_EMAIL: "true",
					EMAIL_INBOX_ADDRESS: "beta-inbox@ateneocode.org",
					EMAIL_PUBLIC_BASE_URL: "https://beta.ateneocode.org",
					EMAIL_UNSUBSCRIBE_SECRET: "test-unsubscribe-secret-0123456789",
```

Create `src/server/email/config.ts`:

```ts
import { z } from "zod";

export const SENDING_DOMAIN = "ateneocode.org";

const schema = z.object({
	EMAIL_INBOX_ADDRESS: z.string().email(),
	EMAIL_PUBLIC_BASE_URL: z.string().url(),
	EMAIL_UNSUBSCRIBE_SECRET: z.string().min(16),
	EMAIL_BATCH_PER_TICK: z.coerce.number().int().min(1).max(200).default(25),
	EMAIL_DAILY_CAP: z.coerce.number().int().min(1).default(300),
});

export type EmailConfig = {
	inboxAddress: string;
	publicBaseUrl: string;
	unsubscribeSecret: string;
	batchPerTick: number;
	dailyCap: number;
};

/** Reads the EMAIL_* vars from a Worker env (or any record). Throws when one is missing. */
export function emailConfigFrom(env: Record<string, unknown>): EmailConfig {
	const parsed = schema.parse(env);
	return {
		inboxAddress: parsed.EMAIL_INBOX_ADDRESS.toLowerCase(),
		publicBaseUrl: parsed.EMAIL_PUBLIC_BASE_URL.replace(/\/+$/, ""),
		unsubscribeSecret: parsed.EMAIL_UNSUBSCRIBE_SECRET,
		batchPerTick: parsed.EMAIL_BATCH_PER_TICK,
		dailyCap: parsed.EMAIL_DAILY_CAP,
	};
}

/** `inbox@x` + `tag` gives `inbox+tag@x`. Email Routing subaddressing delivers it to the `inbox@x` rule. */
export function plusAddress(inbox: string, tag: string): string {
	const [local, domain] = inbox.split("@");
	return `${local}+${tag}@${domain}`;
}

/** Reads the `+tag` back out of a recipient address, lowercased. */
export function plusTag(address: string): string | null {
	const match = /^[^+@\s]+\+([^@\s]+)@/.exec(address.trim().toLowerCase());
	return match ? match[1] : null;
}

export function isSendingAddress(address: string): boolean {
	return address.trim().toLowerCase().endsWith(`@${SENDING_DOMAIN}`);
}
```

- [ ] **Step 4: Run tests, typecheck, and the full suite**

Run: `pnpm exec vitest run src/server/auth/permissions.email.test.ts src/server/email/config.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: no errors. If a `Record<RoleKey, ...>` or `Record<FeatureKey, ...>` elsewhere errors, add an `email` entry there with a label matching its neighbours (for example `email: "Email"`).

Run: `pnpm test:workers`
Expected: PASS. If `src/server/features.test.ts` or `src/app/portal/admin/nav.test.ts` asserts the exact key list, add `email` to the expected value.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/permissions.ts src/server/auth/permissions.email.test.ts src/server/features.ts src/server/env.ts src/server/email/config.ts src/server/email/config.test.ts src/db/repositories/audit.ts src/app/portal/admin/system/audit/page.tsx src/db/seed/data.ts vitest.config.mts
git commit -m "feat(email): add email role, permissions, feature flag, and config"
```

---

### Task 2: Shared email types, schema, and migration 0007

**Files:**
- Create: `src/lib/email/types.ts`
- Modify: `src/db/schema.ts` (append tables at the end of the file)
- Create: `drizzle/migrations/0007_<generated>.sql` (generated, then hand-appended)
- Modify: `src/lib/links.ts:1` (`RESERVED_SLUG_DEFAULTS`)
- Modify: `scripts/verify-preservation.ts`

**Interfaces:**
- Produces types: `EmailBlock`, `EmailBlockType`, `AudienceRule`, `Audience`, `EmailCampaignStatus`, `EmailDeliveryStatus`.
- Produces tables: `emailSenders`, `emailCategories`, `emailTemplates`, `emailCampaigns`, `emailDeliveries`, `emailOptouts`, `emailThreads`, `emailMessages`.

- [ ] **Step 1: Create the types**

`src/lib/email/types.ts`:

```ts
export type EmailBlock =
	| { id: string; type: "heading"; props: { text: string; level: 1 | 2 } }
	| { id: string; type: "text"; props: { text: string } }
	| { id: string; type: "button"; props: { label: string; href: string } }
	| { id: string; type: "image"; props: { src: string; alt: string; href?: string } }
	| { id: string; type: "divider"; props: Record<string, never> }
	| { id: string; type: "spacer"; props: { size: "sm" | "md" | "lg" } }
	| {
			id: string;
			type: "event";
			/** title/when/place/path are a snapshot taken when the block is picked and again when the email is scheduled. */
			props: { eventId: string; title: string; when: string; place: string; path: string };
	  };

export type EmailBlockType = EmailBlock["type"];

export type AudienceRule =
	| { kind: "roster"; termId: "current" | string }
	| { kind: "role"; roleKey: string }
	| { kind: "batch"; batch: string }
	| { kind: "status"; status: "active" | "pending" | "inactive" }
	| { kind: "event"; eventId: string; relation: "rsvp" | "attended" | "no_show" }
	| { kind: "member"; memberId: string };

export type Audience = {
	match: "all" | "any";
	include: AudienceRule[];
	exclude: AudienceRule[];
};

export const EMPTY_AUDIENCE: Audience = { match: "any", include: [], exclude: [] };

export type EmailCampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled" | "failed";
export type EmailDeliveryStatus = "pending" | "sent" | "failed" | "skipped_optout" | "cancelled";
```

- [ ] **Step 2: Add the tables to `src/db/schema.ts`**

Add to the imports at the top of `src/db/schema.ts`:

```ts
import type { Audience, EmailBlock, EmailCampaignStatus, EmailDeliveryStatus } from "@/lib/email/types";
```

Append at the end of the file (uses the existing `sqliteTable`, `text`, `integer`, `index`, `uniqueIndex`, `primaryKey`, `nowMs` already in scope):

```ts
export const emailSenders = sqliteTable(
	"email_senders",
	{
		id: text("id").primaryKey(),
		address: text("address").notNull(),
		displayName: text("display_name").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
	},
	(table) => [uniqueIndex("email_senders_address_unique").on(table.address)],
);

export const emailCategories = sqliteTable("email_categories", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	description: text("description").notNull().default(""),
	required: integer("required", { mode: "boolean" }).notNull().default(false),
	defaultSenderId: text("default_sender_id").references(() => emailSenders.id, { onDelete: "set null" }),
	sortOrder: integer("sort_order").notNull().default(0),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
});

export const emailTemplates = sqliteTable("email_templates", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	categoryId: text("category_id").references(() => emailCategories.id, { onDelete: "set null" }),
	subject: text("subject").notNull().default(""),
	preheader: text("preheader").notNull().default(""),
	blocks: text("blocks", { mode: "json" }).$type<EmailBlock[]>().notNull().default([]),
	createdBy: text("created_by").references(() => members.id, { onDelete: "set null" }),
	updatedBy: text("updated_by").references(() => members.id, { onDelete: "set null" }),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
});

export const emailCampaigns = sqliteTable(
	"email_campaigns",
	{
		id: text("id").primaryKey(),
		templateId: text("template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
		categoryId: text("category_id").references(() => emailCategories.id, { onDelete: "set null" }),
		senderId: text("sender_id").references(() => emailSenders.id, { onDelete: "set null" }),
		subject: text("subject").notNull().default(""),
		preheader: text("preheader").notNull().default(""),
		blocks: text("blocks", { mode: "json" }).$type<EmailBlock[]>().notNull().default([]),
		audience: text("audience", { mode: "json" }).$type<Audience>().notNull(),
		status: text("status").$type<EmailCampaignStatus>().notNull().default("draft"),
		scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
		recipientCount: integer("recipient_count").notNull().default(0),
		sentCount: integer("sent_count").notNull().default(0),
		failedCount: integer("failed_count").notNull().default(0),
		skippedCount: integer("skipped_count").notNull().default(0),
		createdBy: text("created_by").references(() => members.id, { onDelete: "set null" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [index("email_campaigns_status_scheduled_idx").on(table.status, table.scheduledAt)],
);

export const emailDeliveries = sqliteTable(
	"email_deliveries",
	{
		id: text("id").primaryKey(),
		campaignId: text("campaign_id")
			.notNull()
			.references(() => emailCampaigns.id, { onDelete: "cascade" }),
		memberId: text("member_id").references(() => members.id, { onDelete: "set null" }),
		email: text("email").notNull(),
		status: text("status").$type<EmailDeliveryStatus>().notNull().default("pending"),
		attempts: integer("attempts").notNull().default(0),
		nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }),
		messageId: text("message_id"),
		error: text("error"),
		sentAt: integer("sent_at", { mode: "timestamp_ms" }),
		readAt: integer("read_at", { mode: "timestamp_ms" }),
	},
	(table) => [
		uniqueIndex("email_deliveries_campaign_member_unique").on(table.campaignId, table.memberId),
		index("email_deliveries_status_next_idx").on(table.status, table.nextAttemptAt),
		index("email_deliveries_member_status_idx").on(table.memberId, table.status),
		index("email_deliveries_sent_at_idx").on(table.sentAt),
	],
);

export const emailOptouts = sqliteTable(
	"email_optouts",
	{
		memberId: text("member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		categoryId: text("category_id")
			.notNull()
			.references(() => emailCategories.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [primaryKey({ columns: [table.memberId, table.categoryId] })],
);

export const emailThreads = sqliteTable(
	"email_threads",
	{
		id: text("id").primaryKey(),
		campaignId: text("campaign_id").references(() => emailCampaigns.id, { onDelete: "set null" }),
		memberId: text("member_id").references(() => members.id, { onDelete: "set null" }),
		fromEmail: text("from_email").notNull(),
		fromName: text("from_name"),
		subject: text("subject").notNull(),
		status: text("status").$type<"open" | "done">().notNull().default("open"),
		assigneeId: text("assignee_id").references(() => members.id, { onDelete: "set null" }),
		unread: integer("unread", { mode: "boolean" }).notNull().default(true),
		isAuto: integer("is_auto", { mode: "boolean" }).notNull().default(false),
		lastMessageAt: integer("last_message_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		index("email_threads_status_last_idx").on(table.status, table.lastMessageAt),
		index("email_threads_campaign_from_idx").on(table.campaignId, table.fromEmail),
	],
);

export const emailMessages = sqliteTable(
	"email_messages",
	{
		id: text("id").primaryKey(),
		threadId: text("thread_id")
			.notNull()
			.references(() => emailThreads.id, { onDelete: "cascade" }),
		direction: text("direction").$type<"in" | "out">().notNull(),
		messageId: text("message_id"),
		inReplyTo: text("in_reply_to"),
		referencesHeader: text("references_header"),
		fromEmail: text("from_email").notNull(),
		toEmail: text("to_email").notNull(),
		subject: text("subject").notNull(),
		text: text("text"),
		html: text("html"),
		rawKey: text("raw_key"),
		sentBy: text("sent_by").references(() => members.id, { onDelete: "set null" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		index("email_messages_message_id_idx").on(table.messageId),
		index("email_messages_thread_created_idx").on(table.threadId, table.createdAt),
	],
);
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/migrations/0007_<words>.sql` containing `CREATE TABLE` for the 8 tables and their indexes, and no `DROP` statements. If it contains any `DROP` or `__new_` table rebuild of an existing table, stop and report: the schema has drifted.

- [ ] **Step 4: Append the seed lines to that file**

Append to the end of the generated `0007_*.sql` (keep the breakpoint marker between statements):

```sql
--> statement-breakpoint
INSERT OR IGNORE INTO `roles` (`id`, `key`, `label`, `description`, `kind`) VALUES ('role_email', 'email', 'Email', 'Sends member emails and manages templates, categories, and the reply inbox.', 'admin');--> statement-breakpoint
INSERT OR IGNORE INTO `reserved_slugs` (`slug`) VALUES ('unsubscribe');
```

`src/lib/links.ts` line 1: add `"unsubscribe"` to `RESERVED_SLUG_DEFAULTS` after `"services"`.

`scripts/verify-preservation.ts`: directly before `db.close();` add:

```ts
for (const file of files.filter((f) => f > "0004_unify_schema.sql")) applyOne(file);
check("email role seeded", one("SELECT COUNT(*) AS v FROM roles WHERE id='role_email'"), 1);
check("unsubscribe slug reserved", one("SELECT COUNT(*) AS v FROM reserved_slugs WHERE slug='unsubscribe'"), 1);
check("email_deliveries exists", one("SELECT COUNT(*) AS v FROM sqlite_master WHERE type='table' AND name='email_deliveries'"), 1);
```

- [ ] **Step 5: Verify**

Run: `pnpm exec tsx scripts/verify-trunk.ts`
Expected: success (the migrations directory and `schema.ts` agree).

Run: `pnpm exec tsx scripts/verify-preservation.ts`
Expected: `PRESERVATION OK`.

Run: `pnpm typecheck && pnpm test:workers`
Expected: PASS. The vitest pool applies the new migration through `TEST_MIGRATIONS`. If a links test asserts the exact reserved list, add `"unsubscribe"` to it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/email/types.ts src/db/schema.ts drizzle/migrations src/lib/links.ts scripts/verify-preservation.ts
git commit -m "feat(email): add email tables, email role seed, and reserved unsubscribe slug"
```

---

### Task 3: Block and audience schemas, merge tags

**Files:**
- Create: `src/lib/email/merge.ts`
- Create: `src/lib/email/blocks.ts`
- Test: `src/lib/email/merge.test.ts`
- Test: `src/lib/email/blocks.test.ts`

**Interfaces:**
- Consumes: `EmailBlock`, `Audience` from `src/lib/email/types.ts`.
- Produces (merge.ts): `MERGE_TAGS`, `type MergeTag`, `type MergeValues = Record<MergeTag, string>`, `findUnknownTags(input: string): string[]`, `replaceTags(input: string, resolve: (tag: MergeTag) => string): string`, `mergeValuesFor(member: MergeMember): MergeValues`, `type MergeMember = { email: string; name: string | null; fullName: string | null; nickname: string | null; batch: string | null }`, `SAMPLE_MERGE_VALUES: MergeValues`.
- Produces (blocks.ts): `blockSchema`, `blocksSchema`, `audienceSchema`, `emailContentSchema` (`{ subject, preheader, blocks }`), `newBlock(type: EmailBlockType): EmailBlock`.

- [ ] **Step 1: Write the failing tests**

`src/lib/email/merge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findUnknownTags, mergeValuesFor, replaceTags } from "./merge";

describe("findUnknownTags", () => {
	it("returns tags outside the allowed list, once each", () => {
		expect(findUnknownTags("Hi {{first_name}}, {{ points }} and {{points}}")).toEqual(["points"]);
	});
	it("accepts spacing inside braces", () => {
		expect(findUnknownTags("{{ full_name }}")).toEqual([]);
	});
});

describe("replaceTags", () => {
	it("replaces known tags and leaves unknown text alone", () => {
		expect(replaceTags("Hi {{ first_name }} {{nope}}", (tag) => tag.toUpperCase())).toBe("Hi FIRST_NAME {{nope}}");
	});
});

describe("mergeValuesFor", () => {
	it("takes the first name from full name, then name, then nickname", () => {
		const base = { email: "a@x.com", name: null, fullName: null, nickname: null, batch: null };
		expect(mergeValuesFor({ ...base, fullName: "Juan Dela Cruz" }).first_name).toBe("Juan");
		expect(mergeValuesFor({ ...base, name: "Maria Clara" }).first_name).toBe("Maria");
		expect(mergeValuesFor({ ...base, nickname: "Jo" }).first_name).toBe("Jo");
		expect(mergeValuesFor(base).first_name).toBe("there");
	});
	it("fills every tag with a string", () => {
		const values = mergeValuesFor({ email: "a@x.com", name: "A B", fullName: null, nickname: null, batch: "2027" });
		expect(values).toEqual({ first_name: "A", full_name: "A B", nickname: "A", batch: "2027", email: "a@x.com" });
	});
});
```

`src/lib/email/blocks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { audienceSchema, blocksSchema, emailContentSchema, newBlock } from "./blocks";

describe("blocksSchema", () => {
	it("accepts every new block type", () => {
		const blocks = (["heading", "text", "button", "image", "divider", "spacer"] as const).map((type) => newBlock(type));
		expect(blocksSchema.safeParse(blocks).success).toBe(true);
	});

	it("rejects http and javascript links", () => {
		const button = { id: "b1", type: "button", props: { label: "Go", href: "javascript:alert(1)" } };
		const image = { id: "i1", type: "image", props: { src: "http://x.com/a.png", alt: "" } };
		expect(blocksSchema.safeParse([button]).success).toBe(false);
		expect(blocksSchema.safeParse([image]).success).toBe(false);
	});

	it("rejects unknown merge tags inside text", () => {
		const text = { id: "t1", type: "text", props: { text: "Hi {{points}}" } };
		const result = blocksSchema.safeParse([text]);
		expect(result.success).toBe(false);
		expect(JSON.stringify(result.error?.issues)).toContain("points");
	});

	it("rejects more than 60 blocks", () => {
		expect(blocksSchema.safeParse(Array.from({ length: 61 }, () => newBlock("divider"))).success).toBe(false);
	});
});

describe("emailContentSchema", () => {
	it("rejects unknown tags in the subject", () => {
		expect(emailContentSchema.safeParse({ subject: "Hi {{nope}}", preheader: "", blocks: [] }).success).toBe(false);
	});
});

describe("audienceSchema", () => {
	it("accepts mixed rules", () => {
		const audience = {
			match: "all",
			include: [{ kind: "roster", termId: "current" }, { kind: "member", memberId: "mem_1" }],
			exclude: [{ kind: "event", eventId: "evt_1", relation: "attended" }],
		};
		expect(audienceSchema.safeParse(audience).success).toBe(true);
	});
	it("rejects unknown rule kinds", () => {
		expect(audienceSchema.safeParse({ match: "any", include: [{ kind: "everyone" }], exclude: [] }).success).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/lib/email`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/lib/email/merge.ts`**

```ts
export const MERGE_TAGS = ["first_name", "full_name", "nickname", "batch", "email"] as const;
export type MergeTag = (typeof MERGE_TAGS)[number];
export type MergeValues = Record<MergeTag, string>;
export type MergeMember = {
	email: string;
	name: string | null;
	fullName: string | null;
	nickname: string | null;
	batch: string | null;
};

export const MERGE_TAG_LABELS: Record<MergeTag, string> = {
	first_name: "First name",
	full_name: "Full name",
	nickname: "Nickname",
	batch: "Batch",
	email: "Email",
};

export const SAMPLE_MERGE_VALUES: MergeValues = {
	first_name: "Juan",
	full_name: "Juan Dela Cruz",
	nickname: "Juan",
	batch: "2027",
	email: "juan.delacruz@student.ateneo.edu",
};

const TAG_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;
const isMergeTag = (value: string): value is MergeTag => (MERGE_TAGS as readonly string[]).includes(value);

export function findUnknownTags(input: string): string[] {
	const unknown = new Set<string>();
	for (const match of input.matchAll(TAG_PATTERN)) if (!isMergeTag(match[1])) unknown.add(match[1]);
	return [...unknown];
}

/** Replaces known tags with `resolve(tag)`. Unknown tags stay as written; validation rejects them before save. */
export function replaceTags(input: string, resolve: (tag: MergeTag) => string): string {
	return input.replace(TAG_PATTERN, (whole, tag: string) => (isMergeTag(tag) ? resolve(tag) : whole));
}

const firstWord = (value: string | null) => value?.trim().split(/\s+/)[0] || null;

export function mergeValuesFor(member: MergeMember): MergeValues {
	const fullName = member.fullName?.trim() || member.name?.trim() || "";
	const firstName = firstWord(member.fullName) ?? firstWord(member.name) ?? (member.nickname?.trim() || "there");
	return {
		first_name: firstName,
		full_name: fullName || firstName,
		nickname: member.nickname?.trim() || firstName,
		batch: member.batch?.trim() || "",
		email: member.email,
	};
}
```

- [ ] **Step 4: Implement `src/lib/email/blocks.ts`**

```ts
import { z } from "zod";
import { findUnknownTags } from "./merge";
import type { EmailBlock, EmailBlockType } from "./types";

const httpsUrl = z
	.string()
	.trim()
	.max(2000)
	.refine((value) => /^https:\/\/[^\s]+$/i.test(value), "Use a link that starts with https://");
const linkUrl = z
	.string()
	.trim()
	.max(2000)
	.refine((value) => /^(https:\/\/|mailto:)[^\s]+$/i.test(value), "Use a link that starts with https:// or mailto:");

const tagged = (max: number) =>
	z
		.string()
		.max(max)
		.superRefine((value, ctx) => {
			const unknown = findUnknownTags(value);
			if (unknown.length > 0) ctx.addIssue({ code: "custom", message: `Unknown field: ${unknown.join(", ")}` });
		});

const id = z.string().min(1).max(40);

export const blockSchema = z.discriminatedUnion("type", [
	z.object({ id, type: z.literal("heading"), props: z.object({ text: tagged(200), level: z.union([z.literal(1), z.literal(2)]) }) }),
	z.object({ id, type: z.literal("text"), props: z.object({ text: tagged(5000) }) }),
	z.object({ id, type: z.literal("button"), props: z.object({ label: tagged(80), href: linkUrl }) }),
	z.object({
		id,
		type: z.literal("image"),
		props: z.object({ src: httpsUrl, alt: z.string().max(200), href: linkUrl.optional() }),
	}),
	z.object({ id, type: z.literal("divider"), props: z.object({}).strict() }),
	z.object({ id, type: z.literal("spacer"), props: z.object({ size: z.enum(["sm", "md", "lg"]) }) }),
	z.object({
		id,
		type: z.literal("event"),
		props: z.object({
			eventId: z.string().min(1),
			title: z.string().max(200),
			when: z.string().max(120),
			place: z.string().max(200),
			path: z.string().regex(/^\/portal\/calendar\/[A-Za-z0-9_-]+$/),
		}),
	}),
]);

export const blocksSchema = z.array(blockSchema).max(60);

export const emailContentSchema = z.object({
	subject: tagged(200),
	preheader: tagged(200),
	blocks: blocksSchema,
});

const ruleSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("roster"), termId: z.string().min(1) }),
	z.object({ kind: z.literal("role"), roleKey: z.string().min(1) }),
	z.object({ kind: z.literal("batch"), batch: z.string().min(1).max(40) }),
	z.object({ kind: z.literal("status"), status: z.enum(["active", "pending", "inactive"]) }),
	z.object({ kind: z.literal("event"), eventId: z.string().min(1), relation: z.enum(["rsvp", "attended", "no_show"]) }),
	z.object({ kind: z.literal("member"), memberId: z.string().min(1) }),
]);

export const audienceSchema = z.object({
	match: z.enum(["all", "any"]),
	include: z.array(ruleSchema).max(100),
	exclude: z.array(ruleSchema).max(100),
});

const blockId = () => `blk_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;

/** Default content for a block added from the palette. */
export function newBlock(type: Exclude<EmailBlockType, "event">): EmailBlock {
	switch (type) {
		case "heading":
			return { id: blockId(), type, props: { text: "Heading", level: 1 } };
		case "text":
			return { id: blockId(), type, props: { text: "Hi {{first_name}}," } };
		case "button":
			return { id: blockId(), type, props: { label: "Open the portal", href: "https://beta.ateneocode.org/portal" } };
		case "image":
			return { id: blockId(), type, props: { src: "https://beta.ateneocode.org/code-doc-cover.png", alt: "" } };
		case "divider":
			return { id: blockId(), type, props: {} };
		case "spacer":
			return { id: blockId(), type, props: { size: "md" } };
	}
}

export function newEventBlock(props: { eventId: string; title: string; when: string; place: string }): EmailBlock {
	return { id: blockId(), type: "event", props: { ...props, path: `/portal/calendar/${props.eventId}` } };
}
```

The test calls `newBlock` with `"heading" ... "spacer"` only. The `event` block comes from `newEventBlock`.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run src/lib/email`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/email/merge.ts src/lib/email/merge.test.ts src/lib/email/blocks.ts src/lib/email/blocks.test.ts
git commit -m "feat(email): add block and audience schemas with merge tags"
```

---

### Task 4: Pure email renderer

**Files:**
- Create: `src/lib/email/render.ts`
- Test: `src/lib/email/render.test.ts`

**Interfaces:**
- Consumes: `EmailBlock` (types), `MergeTag`, `MergeValues`, `replaceTags` (merge).
- Produces:
  - `escapeHtml(value: string): string`
  - `type TagResolver = (tag: MergeTag) => string` (must return HTML-safe output)
  - `valueResolver(values: MergeValues): TagResolver`
  - `pillResolver: TagResolver`
  - `renderBlockHtml(block: EmailBlock, resolve: TagResolver, baseUrl: string): string`
  - `renderHeaderHtml(logoUrl: string): string`
  - `renderFooterHtml(footer: FooterInput): string`
  - `type FooterInput = { categoryName: string; required: boolean; archiveUrl: string | null; preferencesUrl: string; unsubscribeUrl: string | null }`
  - `type RenderInput = { subject: string; preheader: string; blocks: EmailBlock[]; resolve: TagResolver; values: MergeValues; baseUrl: string; footer: FooterInput }`
  - `type RenderedEmail = { subject: string; html: string; bodyHtml: string; text: string }`
  - `renderEmail(input: RenderInput): RenderedEmail`
  - `EMAIL_COLORS` constant.

- [ ] **Step 1: Write the failing test**

`src/lib/email/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { EmailBlock } from "./types";
import { escapeHtml, pillResolver, renderBlockHtml, renderEmail, valueResolver } from "./render";

const values = { first_name: "<b>Eve</b>", full_name: "Eve", nickname: "Eve", batch: "2027", email: "eve@x.com" };
const footer = {
	categoryName: "Newsletter",
	required: false,
	archiveUrl: "https://beta.ateneocode.org/portal/mail/edl_1",
	preferencesUrl: "https://beta.ateneocode.org/portal/mail/preferences",
	unsubscribeUrl: "https://beta.ateneocode.org/unsubscribe?t=abc",
};
const blocks: EmailBlock[] = [
	{ id: "h", type: "heading", props: { text: "Hello {{first_name}}", level: 1 } },
	{ id: "t", type: "text", props: { text: "Read **this** and [the guide](https://x.com/a?b=1&c=2).\n\nNew paragraph <script>" } },
	{ id: "b", type: "button", props: { label: "RSVP", href: "https://x.com/rsvp" } },
	{ id: "e", type: "event", props: { eventId: "evt_1", title: "GA", when: "Oct 5, 9:00 AM", place: "Room 1", path: "/portal/calendar/evt_1" } },
];

function render(overrides: Partial<Parameters<typeof renderEmail>[0]> = {}) {
	return renderEmail({
		subject: "Hi {{first_name}}",
		preheader: "Quick update",
		blocks,
		resolve: valueResolver(values),
		values,
		baseUrl: "https://beta.ateneocode.org",
		footer,
		...overrides,
	});
}

describe("renderEmail", () => {
	it("escapes merge values and author text", () => {
		const { html } = render();
		expect(html).toContain("Hello &lt;b&gt;Eve&lt;/b&gt;");
		expect(html).toContain("New paragraph &lt;script&gt;");
		expect(html).not.toContain("<script>");
	});

	it("renders inline marks and https links only", () => {
		const { html } = render();
		expect(html).toContain("<strong>this</strong>");
		expect(html).toContain('href="https://x.com/a?b=1&amp;c=2"');
	});

	it("merges the subject with raw values for the subject line", () => {
		expect(render().subject).toBe("Hi <b>Eve</b>");
	});

	it("puts the preheader in a hidden span", () => {
		expect(render().html).toMatch(/display:none[^>]*>Quick update/);
	});

	it("links the event block to the absolute portal URL", () => {
		expect(render().html).toContain('href="https://beta.ateneocode.org/portal/calendar/evt_1"');
	});

	it("shows unsubscribe only for optional categories", () => {
		expect(render().html).toContain("Unsubscribe from Newsletter");
		const required = render({ footer: { ...footer, required: true, unsubscribeUrl: null } });
		expect(required.html).not.toContain("Unsubscribe");
		expect(required.html).toContain("Email preferences");
	});

	it("builds a plain-text alternative with link targets", () => {
		const { text } = render();
		expect(text).toContain("Hello <b>Eve</b>");
		expect(text).toContain("RSVP: https://x.com/rsvp");
		expect(text).toContain("the guide (https://x.com/a?b=1&c=2)");
		expect(text).toContain("Unsubscribe: https://beta.ateneocode.org/unsubscribe?t=abc");
	});
});

describe("renderBlockHtml", () => {
	it("shows tags as pills in editor mode", () => {
		const html = renderBlockHtml(blocks[0], pillResolver, "https://beta.ateneocode.org");
		expect(html).toContain("data-merge-tag=\"first_name\"");
	});
});

describe("escapeHtml", () => {
	it("escapes the five HTML characters", () => {
		expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/email/render.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/email/render.ts`**

```ts
import { replaceTags, type MergeTag, type MergeValues } from "./merge";
import type { EmailBlock } from "./types";

export const EMAIL_COLORS = {
	navy: "#06192F",
	blue: "#0C315C",
	light: "#D7DFE9",
	ink: "#121315",
	muted: "#3D5266",
	pale: "#90B4CC",
	page: "#F5F5F6",
	line: "#AAAFB5",
} as const;

const HEADING_FONT = "Georgia, 'Times New Roman', serif";
const BODY_FONT = "Helvetica, Arial, sans-serif";

export type TagResolver = (tag: MergeTag) => string;

export function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export const valueResolver =
	(values: MergeValues): TagResolver =>
	(tag) =>
		escapeHtml(values[tag]);

export const pillResolver: TagResolver = (tag) =>
	`<span data-merge-tag="${tag}" style="display:inline-block;padding:0 6px;border-radius:999px;background:${EMAIL_COLORS.light};color:${EMAIL_COLORS.blue};font-size:0.85em;font-family:${BODY_FONT};">${tag.replace("_", " ")}</span>`;

/** Escape first, then merge (resolvers return HTML-safe output), then apply inline marks. */
function richText(text: string, resolve: TagResolver): string {
	const merged = replaceTags(escapeHtml(text), resolve);
	return merged
		.replace(/\[([^\]]+)\]\(((?:https:\/\/|mailto:)[^\s)]+)\)/g, `<a href="$2" style="color:${EMAIL_COLORS.blue};text-decoration:underline;">$1</a>`)
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

function paragraphs(text: string, resolve: TagResolver): string {
	return text
		.split(/\n{2,}/)
		.map((part) => part.trim())
		.filter(Boolean)
		.map(
			(part) =>
				`<p style="margin:0 0 16px;font-family:${BODY_FONT};font-size:16px;line-height:1.6;color:${EMAIL_COLORS.ink};">${richText(part, resolve).replaceAll("\n", "<br>")}</p>`,
		)
		.join("");
}

const row = (inner: string, padding = "0 32px") => `<tr><td style="padding:${padding};">${inner}</td></tr>`;
const SPACER = { sm: 8, md: 24, lg: 48 } as const;

export function renderBlockHtml(block: EmailBlock, resolve: TagResolver, baseUrl: string): string {
	switch (block.type) {
		case "heading": {
			const size = block.props.level === 1 ? 28 : 21;
			const tag = block.props.level === 1 ? "h1" : "h2";
			return row(
				`<${tag} style="margin:0 0 12px;font-family:${HEADING_FONT};font-size:${size}px;line-height:1.25;font-weight:normal;color:${EMAIL_COLORS.navy};">${richText(block.props.text, resolve)}</${tag}>`,
			);
		}
		case "text":
			return row(paragraphs(block.props.text, resolve));
		case "button":
			return row(
				`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:8px;background:${EMAIL_COLORS.navy};"><a href="${escapeHtml(block.props.href)}" style="display:inline-block;padding:12px 22px;font-family:${BODY_FONT};font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none;">${richText(block.props.label, resolve)}</a></td></tr></table>`,
			);
		case "image": {
			const img = `<img src="${escapeHtml(block.props.src)}" alt="${escapeHtml(block.props.alt)}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:8px;">`;
			const inner = block.props.href ? `<a href="${escapeHtml(block.props.href)}">${img}</a>` : img;
			return row(`<div style="margin:0 0 16px;">${inner}</div>`);
		}
		case "divider":
			return row(`<div style="height:1px;background:${EMAIL_COLORS.light};margin:8px 0 24px;line-height:1px;font-size:1px;">&nbsp;</div>`);
		case "spacer":
			return row(`<div style="height:${SPACER[block.props.size]}px;line-height:1px;font-size:1px;">&nbsp;</div>`, "0");
		case "event": {
			const href = escapeHtml(`${baseUrl}${block.props.path}`);
			return row(
				`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid ${EMAIL_COLORS.light};border-radius:10px;"><tr><td style="padding:16px 18px;font-family:${BODY_FONT};"><div style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${EMAIL_COLORS.muted};">Event</div><div style="margin:4px 0 6px;font-family:${HEADING_FONT};font-size:20px;color:${EMAIL_COLORS.navy};">${escapeHtml(block.props.title)}</div><div style="font-size:15px;color:${EMAIL_COLORS.ink};">${escapeHtml(block.props.when)} &middot; ${escapeHtml(block.props.place)}</div><a href="${href}" style="display:inline-block;margin-top:10px;font-size:15px;font-weight:bold;color:${EMAIL_COLORS.blue};">View event</a></td></tr></table>`,
			);
		}
	}
}

export function renderHeaderHtml(logoUrl: string): string {
	return `<tr><td style="padding:28px 32px 20px;"><img src="${escapeHtml(logoUrl)}" alt="CODE" width="120" style="display:block;width:120px;height:auto;border:0;"></td></tr>`;
}

export type FooterInput = {
	categoryName: string;
	required: boolean;
	archiveUrl: string | null;
	preferencesUrl: string;
	unsubscribeUrl: string | null;
};

const footerLink = (href: string, label: string) =>
	`<a href="${escapeHtml(href)}" style="color:${EMAIL_COLORS.muted};text-decoration:underline;">${label}</a>`;

export function renderFooterHtml(footer: FooterInput): string {
	const links = [
		footer.archiveUrl ? footerLink(footer.archiveUrl, "Read in the portal") : null,
		footerLink(footer.preferencesUrl, "Email preferences"),
		!footer.required && footer.unsubscribeUrl ? footerLink(footer.unsubscribeUrl, `Unsubscribe from ${escapeHtml(footer.categoryName)}`) : null,
	].filter(Boolean);
	return `<tr><td style="padding:24px 32px 32px;border-top:1px solid ${EMAIL_COLORS.light};font-family:${BODY_FONT};font-size:13px;line-height:1.6;color:${EMAIL_COLORS.muted};">You are getting this because you are a CODE member. Category: ${escapeHtml(footer.categoryName)}.<br>${links.join(" &middot; ")}</td></tr>`;
}

export type RenderInput = {
	subject: string;
	preheader: string;
	blocks: EmailBlock[];
	resolve: TagResolver;
	values: MergeValues;
	baseUrl: string;
	footer: FooterInput;
};

export type RenderedEmail = { subject: string; html: string; bodyHtml: string; text: string };

function blockText(block: EmailBlock, values: MergeValues, baseUrl: string): string {
	const merge = (text: string) => replaceTags(text, (tag) => values[tag]);
	const plain = (text: string) =>
		merge(text)
			.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
			.replace(/\*\*([^*]+)\*\*/g, "$1")
			.replace(/\*([^*\n]+)\*/g, "$1");
	switch (block.type) {
		case "heading":
			return plain(block.props.text);
		case "text":
			return plain(block.props.text);
		case "button":
			return `${merge(block.props.label)}: ${block.props.href}`;
		case "image":
			return block.props.alt ? `[${block.props.alt}]` : "";
		case "divider":
			return "---";
		case "spacer":
			return "";
		case "event":
			return `${block.props.title}\n${block.props.when} - ${block.props.place}\n${baseUrl}${block.props.path}`;
	}
}

export function renderEmail(input: RenderInput): RenderedEmail {
	const subject = replaceTags(input.subject, (tag) => input.values[tag]);
	const preheader = replaceTags(input.preheader, (tag) => input.values[tag]);
	const logoUrl = `${input.baseUrl}/code-logo-full-navy.png`;
	const bodyHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:12px;">${renderHeaderHtml(logoUrl)}${input.blocks
		.map((block) => renderBlockHtml(block, input.resolve, input.baseUrl))
		.join("")}${renderFooterHtml(input.footer)}</table>`;
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:${EMAIL_COLORS.page};"><span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_COLORS.page};"><tr><td style="padding:24px 12px;">${bodyHtml}</td></tr></table></body></html>`;
	const footerText = [
		`Category: ${input.footer.categoryName}`,
		input.footer.archiveUrl ? `Read in the portal: ${input.footer.archiveUrl}` : null,
		`Email preferences: ${input.footer.preferencesUrl}`,
		!input.footer.required && input.footer.unsubscribeUrl ? `Unsubscribe: ${input.footer.unsubscribeUrl}` : null,
	]
		.filter(Boolean)
		.join("\n");
	const text = [...input.blocks.map((block) => blockText(block, input.values, input.baseUrl)).filter(Boolean), "--", footerText].join("\n\n");
	return { subject, html, bodyHtml, text };
}
```

- [ ] **Step 4: Run test**

Run: `pnpm exec vitest run src/lib/email/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/render.ts src/lib/email/render.test.ts
git commit -m "feat(email): add pure branded email renderer"
```

---

### Task 5: Unsubscribe token

**Files:**
- Create: `src/server/email/unsubscribe-token.ts`
- Test: `src/server/email/unsubscribe-token.test.ts`

**Interfaces:**
- Produces: `signUnsubscribeToken(secret: string, memberId: string, categoryId: string): Promise<string>`, `verifyUnsubscribeToken(secret: string, token: string): Promise<{ memberId: string; categoryId: string } | null>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";

const secret = "test-unsubscribe-secret-0123456789";

describe("unsubscribe token", () => {
	it("round-trips member and category", async () => {
		const token = await signUnsubscribeToken(secret, "mem_abc", "ecat_xyz");
		expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
		expect(await verifyUnsubscribeToken(secret, token)).toEqual({ memberId: "mem_abc", categoryId: "ecat_xyz" });
	});

	it("rejects a tampered payload", async () => {
		const token = await signUnsubscribeToken(secret, "mem_abc", "ecat_xyz");
		const [, sig] = token.split(".");
		const forged = `${btoa("mem_other:ecat_xyz").replaceAll("=", "")}.${sig}`;
		expect(await verifyUnsubscribeToken(secret, forged)).toBeNull();
	});

	it("rejects a different secret and garbage", async () => {
		const token = await signUnsubscribeToken(secret, "mem_abc", "ecat_xyz");
		expect(await verifyUnsubscribeToken("another-secret-0123456789", token)).toBeNull();
		expect(await verifyUnsubscribeToken(secret, "not-a-token")).toBeNull();
		expect(await verifyUnsubscribeToken(secret, "")).toBeNull();
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/server/email/unsubscribe-token.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array | null {
	try {
		const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
		return Uint8Array.from(binary, (char) => char.charCodeAt(0));
	} catch {
		return null;
	}
}

const key = (secret: string) =>
	crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

/** `base64url(memberId:categoryId).base64url(HMAC-SHA256)`. Scoped to one member and one category. */
export async function signUnsubscribeToken(secret: string, memberId: string, categoryId: string): Promise<string> {
	const payload = encoder.encode(`${memberId}:${categoryId}`);
	const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), payload));
	return `${toBase64Url(payload)}.${toBase64Url(signature)}`;
}

export async function verifyUnsubscribeToken(secret: string, token: string): Promise<{ memberId: string; categoryId: string } | null> {
	const [payloadPart, signaturePart, extra] = token.split(".");
	if (!payloadPart || !signaturePart || extra !== undefined) return null;
	const payload = fromBase64Url(payloadPart);
	const signature = fromBase64Url(signaturePart);
	if (!payload || !signature) return null;
	// crypto.subtle.verify compares in constant time.
	const valid = await crypto.subtle.verify("HMAC", await key(secret), signature, payload);
	if (!valid) return null;
	const [memberId, categoryId, rest] = new TextDecoder().decode(payload).split(":");
	if (!memberId || !categoryId || rest !== undefined) return null;
	return { memberId, categoryId };
}
```

- [ ] **Step 4: Run test**

Run: `pnpm exec vitest run src/server/email/unsubscribe-token.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/email/unsubscribe-token.ts src/server/email/unsubscribe-token.test.ts
git commit -m "feat(email): add signed unsubscribe tokens"
```

---

### Task 6: Audience resolver

**Files:**
- Create: `src/db/repositories/email-audience.ts`
- Test: `src/db/repositories/email-audience.integration.test.ts`

**Interfaces:**
- Consumes: `Audience`, `AudienceRule` (types), schema tables `members`, `memberRoles`, `roles`, `terms`, `termMemberRoster`, `eventRsvps`, `crsAttendance`.
- Produces:
  - `type ResolvedRecipient = { memberId: string; email: string; name: string | null; fullName: string | null; nickname: string | null; batch: string | null }`
  - `resolveAudience(db: EmailDb, audience: Audience, now: Date): Promise<ResolvedRecipient[]>` (deduplicated, sorted by email, inactive excluded unless explicit)
  - `memberDisplayName(member: { email: string; name: string | null; fullName: string | null; nickname: string | null }): string`
  - `type EmailDb = DrizzleD1Database<typeof schema>`
  - `chunk<T>(items: T[], size: number): T[][]`

- [ ] **Step 1: Write the failing test**

`src/db/repositories/email-audience.integration.test.ts`:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Audience } from "@/lib/email/types";
import { resolveAudience } from "./email-audience";

const db = drizzle(env.DB, { schema });
const NOW = new Date("2026-10-02T04:00:00Z");

async function member(id: string, batch: string, status = "active") {
	await env.DB.prepare("INSERT INTO members (id, email, name, batch, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
		.bind(id, `${id}@example.com`, id, batch, status, Date.now(), Date.now())
		.run();
}

const ids = async (audience: Audience) => (await resolveAudience(db, audience, NOW)).map((r) => r.memberId);

describe("resolveAudience", () => {
	beforeEach(async () => {
		for (const table of ["crs_attendance", "event_rsvps", "crs_events", "term_member_roster", "terms", "member_roles", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await member("mem_a", "2026");
		await member("mem_b", "2027");
		await member("mem_c", "2027");
		await member("mem_off", "2027", "inactive");
		// role_email is seeded by migration 0007.
		await env.DB.prepare("INSERT INTO member_roles (member_id, role_id, assigned_at) VALUES ('mem_a', 'role_email', ?)").bind(Date.now()).run();
		await env.DB.prepare("INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES ('term_now', 'Now', 10, 5, ?, ?)")
			.bind(Date.parse("2026-08-01T00:00:00Z"), Date.parse("2027-05-31T00:00:00Z"))
			.run();
		for (const id of ["mem_a", "mem_b", "mem_off"]) {
			await env.DB.prepare("INSERT INTO term_member_roster (term_id, email, member_id, added_by, added_at) VALUES ('term_now', ?, ?, 'mem_a', ?)")
				.bind(`${id}@example.com`, id, Date.now())
				.run();
		}
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, place, starts_at, description, created_by, checkin_secret) VALUES ('evt_1', 'GA', 'official', 'Room', ?, 'd', 'mem_a', 's')",
		)
			.bind(Date.parse("2026-09-20T01:00:00Z"))
			.run();
		for (const id of ["mem_b", "mem_c"]) {
			await env.DB.prepare("INSERT INTO event_rsvps (event_id, member_id, state, answers_json, updated_at) VALUES ('evt_1', ?, 'going', '{}', ?)")
				.bind(id, Date.now())
				.run();
		}
		await env.DB.prepare("INSERT INTO crs_attendance (event_id, member_id, scanned_at, scanned_by) VALUES ('evt_1', 'mem_b', ?, 'mem_a')").bind(Date.now()).run();
	});

	it("resolves the current roster without inactive members", async () => {
		expect(await ids({ match: "any", include: [{ kind: "roster", termId: "current" }], exclude: [] })).toEqual(["mem_a", "mem_b"]);
	});

	it("unions with any and intersects with all", async () => {
		const rules = [
			{ kind: "batch", batch: "2027" },
			{ kind: "role", roleKey: "email" },
		] as const;
		expect(await ids({ match: "any", include: [...rules], exclude: [] })).toEqual(["mem_a", "mem_b", "mem_c"]);
		expect(await ids({ match: "all", include: [{ kind: "batch", batch: "2027" }, { kind: "roster", termId: "current" }], exclude: [] })).toEqual(["mem_b"]);
	});

	it("handles RSVP, attended, and no-show", async () => {
		const event = (relation: "rsvp" | "attended" | "no_show"): Audience => ({ match: "any", include: [{ kind: "event", eventId: "evt_1", relation }], exclude: [] });
		expect(await ids(event("rsvp"))).toEqual(["mem_b", "mem_c"]);
		expect(await ids(event("attended"))).toEqual(["mem_b"]);
		expect(await ids(event("no_show"))).toEqual(["mem_c"]);
	});

	it("always adds hand-picked members and always subtracts excludes", async () => {
		const audience: Audience = {
			match: "all",
			include: [{ kind: "batch", batch: "2027" }, { kind: "member", memberId: "mem_a" }],
			exclude: [{ kind: "member", memberId: "mem_c" }],
		};
		expect(await ids(audience)).toEqual(["mem_a", "mem_b"]);
	});

	it("includes inactive members only when asked explicitly", async () => {
		expect(await ids({ match: "any", include: [{ kind: "status", status: "inactive" }], exclude: [] })).toEqual(["mem_off"]);
		expect(await ids({ match: "any", include: [{ kind: "member", memberId: "mem_off" }], exclude: [] })).toEqual(["mem_off"]);
	});

	it("returns nothing for an empty include", async () => {
		expect(await ids({ match: "any", include: [], exclude: [] })).toEqual([]);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/db/repositories/email-audience.integration.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/db/repositories/email-audience.ts`**

```ts
import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { crsAttendance, eventRsvps, memberRoles, members, roles, termMemberRoster, terms } from "@/db/schema";
import type { Audience, AudienceRule } from "@/lib/email/types";
import type * as schema from "../schema";

export type EmailDb = DrizzleD1Database<typeof schema>;

export type ResolvedRecipient = {
	memberId: string;
	email: string;
	name: string | null;
	fullName: string | null;
	nickname: string | null;
	batch: string | null;
};

// D1 binds at most 100 parameters per statement.
const ID_CHUNK = 90;

export function chunk<T>(items: T[], size: number): T[][] {
	return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

export function memberDisplayName(member: { email: string; name: string | null; fullName: string | null; nickname: string | null }): string {
	return member.nickname ?? member.fullName ?? member.name ?? member.email;
}

const toSet = (rows: { id: string | null }[]) => new Set(rows.map((row) => row.id).filter((id): id is string => id !== null));

async function currentTermId(db: EmailDb, now: Date): Promise<string | null> {
	const [term] = await db
		.select({ id: terms.id })
		.from(terms)
		.where(and(lte(terms.startsAt, now), gte(terms.endsAt, now)))
		.orderBy(desc(terms.startsAt))
		.limit(1);
	return term?.id ?? null;
}

async function idsForRule(db: EmailDb, rule: AudienceRule, now: Date): Promise<Set<string>> {
	switch (rule.kind) {
		case "member":
			return new Set([rule.memberId]);
		case "batch":
			return toSet(await db.select({ id: members.id }).from(members).where(eq(members.batch, rule.batch)));
		case "status":
			return toSet(await db.select({ id: members.id }).from(members).where(eq(members.status, rule.status)));
		case "role":
			return toSet(
				await db
					.select({ id: memberRoles.memberId })
					.from(memberRoles)
					.innerJoin(roles, eq(roles.id, memberRoles.roleId))
					.where(eq(roles.key, rule.roleKey)),
			);
		case "roster": {
			const termId = rule.termId === "current" ? await currentTermId(db, now) : rule.termId;
			if (!termId) return new Set();
			return toSet(
				await db
					.select({ id: termMemberRoster.memberId })
					.from(termMemberRoster)
					.where(and(eq(termMemberRoster.termId, termId), isNotNull(termMemberRoster.memberId))),
			);
		}
		case "event": {
			const going = toSet(
				await db
					.select({ id: eventRsvps.memberId })
					.from(eventRsvps)
					.where(and(eq(eventRsvps.eventId, rule.eventId), eq(eventRsvps.state, "going"))),
			);
			if (rule.relation === "rsvp") return going;
			const attended = toSet(await db.select({ id: crsAttendance.memberId }).from(crsAttendance).where(eq(crsAttendance.eventId, rule.eventId)));
			if (rule.relation === "attended") return attended;
			return new Set([...going].filter((id) => !attended.has(id)));
		}
	}
}

function intersect(sets: Set<string>[]): Set<string> {
	const [first, ...rest] = sets;
	return new Set([...(first ?? [])].filter((id) => rest.every((set) => set.has(id))));
}

export async function resolveAudience(db: EmailDb, audience: Audience, now: Date): Promise<ResolvedRecipient[]> {
	const picked = new Set(audience.include.flatMap((rule) => (rule.kind === "member" ? [rule.memberId] : [])));
	const groupRules = audience.include.filter((rule) => rule.kind !== "member");
	const groupSets = await Promise.all(groupRules.map((rule) => idsForRule(db, rule, now)));
	const matched =
		groupSets.length === 0 ? new Set<string>() : audience.match === "all" ? intersect(groupSets) : new Set(groupSets.flatMap((set) => [...set]));
	for (const id of picked) matched.add(id);
	for (const set of await Promise.all(audience.exclude.map((rule) => idsForRule(db, rule, now)))) {
		for (const id of set) matched.delete(id);
	}

	const allowInactive = audience.include.some((rule) => rule.kind === "status" && rule.status === "inactive");
	const rows = [];
	for (const part of chunk([...matched], ID_CHUNK)) {
		rows.push(
			...(await db
				.select({
					memberId: members.id,
					email: members.email,
					name: members.name,
					fullName: members.fullName,
					nickname: members.nickname,
					batch: members.batch,
					status: members.status,
				})
				.from(members)
				.where(inArray(members.id, part))),
		);
	}
	return rows
		.filter((row) => row.status !== "inactive" || allowInactive || picked.has(row.memberId))
		.map(({ status: _status, ...recipient }) => recipient)
		.sort((a, b) => a.email.localeCompare(b.email));
}
```

- [ ] **Step 4: Run test**

Run: `pnpm exec vitest run src/db/repositories/email-audience.integration.test.ts`
Expected: PASS. The test file deletes `crs_events`, so check the full suite next.

Run: `pnpm test:workers`
Expected: PASS. If another integration file fails because this file's `DELETE`s ran in a shared database, confirm the vitest config isolates storage per file (the default for the Workers pool). Do not weaken other tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/email-audience.ts src/db/repositories/email-audience.integration.test.ts
git commit -m "feat(email): resolve audiences from roster, roles, batches, status, and events"
```

---

### Task 7: Settings and templates repositories, repository wiring

**Files:**
- Create: `src/db/repositories/email-settings.ts`
- Create: `src/db/repositories/email-templates.ts`
- Create: `src/db/repositories/email.ts`
- Modify: `src/db/repositories/index.ts` (add `email` to both `createDrizzleRepositories` and `createSharedRepositories`)
- Create: `src/lib/email/action-result.ts`
- Test: `src/db/repositories/email-settings.integration.test.ts`
- Test: `src/lib/email/action-result.test.ts`

**Interfaces:**
- Consumes: `EmailDb` (Task 6), `AuditRepository` (`src/db/repositories/audit.ts`), `isSendingAddress` (Task 1), `emailContentSchema` (Task 3).
- Produces (settings):
  - `type EmailSenderRow = InferSelectModel<typeof emailSenders>`, `type EmailCategoryRow = InferSelectModel<typeof emailCategories>`
  - `createEmailSettingsRepository(db, audit)` with:
    - `listSenders(actor, opts?: { includeArchived?: boolean }): Promise<EmailSenderRow[]>` (needs `email:send`)
    - `saveSender(actor, input: { id?: string; address: string; displayName: string }): Promise<EmailSenderRow>` (needs `email:configure`)
    - `setSenderArchived(actor, id: string, archived: boolean): Promise<void>`
    - `listCategories(actor, opts?: { includeArchived?: boolean }): Promise<EmailCategoryRow[]>` (ordered by `sortOrder`, then name)
    - `saveCategory(actor, input: { id?: string; name: string; description: string; required: boolean; defaultSenderId: string | null }): Promise<EmailCategoryRow>`
    - `setCategoryArchived(actor, id: string, archived: boolean): Promise<void>`
    - `moveCategory(actor, id: string, direction: "up" | "down"): Promise<void>`
- Produces (templates):
  - `type EmailTemplateRow = InferSelectModel<typeof emailTemplates>`, `type TemplateListItem = EmailTemplateRow & { usedCount: number; categoryName: string | null }`
  - `createEmailTemplatesRepository(db, audit)` with:
    - `list(actor, opts?: { q?: string; includeArchived?: boolean }): Promise<TemplateListItem[]>` (needs `email:send`)
    - `get(actor, id: string): Promise<EmailTemplateRow | null>` (needs `email:send`)
    - `save(actor, input: { id?: string; name: string; categoryId: string | null; subject: string; preheader: string; blocks: EmailBlock[] }): Promise<EmailTemplateRow>` (needs `email:configure`)
    - `duplicate(actor, id: string): Promise<EmailTemplateRow>`
    - `setArchived(actor, id: string, archived: boolean): Promise<void>`
- Produces (aggregate): `createEmailRepositories(db, audit)` returns `{ settings, templates }` (later tasks add `campaigns`, `inbox`, `member`). `type EmailRepositories`. `createUnavailableEmailRepositories(): EmailRepositories`. `assertEmail(actor, action: "email:send" | "email:configure"): void`.
- Produces (action result): `type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }`, `runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>>`.

- [ ] **Step 1: Write the failing tests**

`src/lib/email/action-result.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runAction } from "./action-result";

describe("runAction", () => {
	it("wraps a value", async () => {
		expect(await runAction(async () => 3)).toEqual({ ok: true, data: 3 });
	});
	it("returns the error message", async () => {
		expect(await runAction(async () => Promise.reject(new Error("Nope.")))).toEqual({ ok: false, error: "Nope." });
	});
	it("returns the first zod issue as plain text", async () => {
		const result = await runAction(async () => z.object({ name: z.string().min(1, "Add a name.") }).parse({ name: "" }));
		expect(result).toEqual({ ok: false, error: "Add a name." });
	});
});
```

`src/db/repositories/email-settings.integration.test.ts`:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createEmailRepositories } from "./email";

const db = drizzle(env.DB, { schema });
const repos = createEmailRepositories(db, createAuditRepository(db));
const admin: Actor = { memberId: "mem_admin", roles: ["email"] };
const member: Actor = { memberId: "mem_plain", roles: ["member"] };

describe("email settings and templates", () => {
	beforeEach(async () => {
		for (const table of ["email_templates", "email_categories", "email_senders", "audit_logs", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		for (const id of ["mem_admin", "mem_plain"]) {
			await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
				.bind(id, `${id}@example.com`, id, Date.now(), Date.now())
				.run();
		}
	});

	it("saves a sender only on the CODE domain, lowercased", async () => {
		const sender = await repos.settings.saveSender(admin, { address: "Events@AteneoCODE.org", displayName: "CODE Events" });
		expect(sender.address).toBe("events@ateneocode.org");
		await expect(repos.settings.saveSender(admin, { address: "me@gmail.com", displayName: "Me" })).rejects.toThrow(/ateneocode\.org/);
	});

	it("refuses members without the email role", async () => {
		await expect(repos.settings.listSenders(member)).rejects.toThrow(/Not authorized/);
		await expect(repos.settings.saveCategory(member, { name: "News", description: "", required: false, defaultSenderId: null })).rejects.toThrow(
			/Not authorized/,
		);
	});

	it("orders categories and moves them", async () => {
		const a = await repos.settings.saveCategory(admin, { name: "Announcements", description: "", required: true, defaultSenderId: null });
		const b = await repos.settings.saveCategory(admin, { name: "Newsletter", description: "", required: false, defaultSenderId: null });
		expect((await repos.settings.listCategories(admin)).map((c) => c.id)).toEqual([a.id, b.id]);
		await repos.settings.moveCategory(admin, b.id, "up");
		expect((await repos.settings.listCategories(admin)).map((c) => c.id)).toEqual([b.id, a.id]);
	});

	it("hides archived categories unless asked", async () => {
		const a = await repos.settings.saveCategory(admin, { name: "Old", description: "", required: false, defaultSenderId: null });
		await repos.settings.setCategoryArchived(admin, a.id, true);
		expect(await repos.settings.listCategories(admin)).toHaveLength(0);
		expect(await repos.settings.listCategories(admin, { includeArchived: true })).toHaveLength(1);
	});

	it("validates template content and duplicates templates", async () => {
		await expect(
			repos.templates.save(admin, { name: "Bad", categoryId: null, subject: "Hi {{points}}", preheader: "", blocks: [] }),
		).rejects.toThrow(/Unknown field/);
		const saved = await repos.templates.save(admin, {
			name: "Weekly",
			categoryId: null,
			subject: "Hi {{first_name}}",
			preheader: "",
			blocks: [{ id: "t", type: "text", props: { text: "Hello" } }],
		});
		const copy = await repos.templates.duplicate(admin, saved.id);
		expect(copy.name).toBe("Weekly (copy)");
		expect(copy.blocks).toEqual(saved.blocks);
		expect((await repos.templates.list(admin)).map((t) => t.name).sort()).toEqual(["Weekly", "Weekly (copy)"]);
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/lib/email/action-result.test.ts src/db/repositories/email-settings.integration.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/lib/email/action-result.ts`**

```ts
import { ZodError } from "zod";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Next masks thrown server-action errors in production, so email actions return their
 * failure as data. Repository errors are written for members to read.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
	try {
		return { ok: true, data: await fn() };
	} catch (error) {
		if (error instanceof ZodError) return { ok: false, error: error.issues[0]?.message ?? "Check the form and try again." };
		return { ok: false, error: error instanceof Error ? error.message : "Something went wrong. Try again." };
	}
}
```

- [ ] **Step 4: Implement `src/db/repositories/email-settings.ts`**

```ts
import { asc, eq, isNull } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { emailCategories, emailSenders } from "@/db/schema";
import { createId } from "@/lib/ids";
import { isSendingAddress, SENDING_DOMAIN } from "@/server/email/config";
import type { Actor } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";
import { assertEmail } from "./email-guard";
import type { EmailDb } from "./email-audience";

export type EmailSenderRow = InferSelectModel<typeof emailSenders>;
export type EmailCategoryRow = InferSelectModel<typeof emailCategories>;

export function createEmailSettingsRepository(db: EmailDb, audit: AuditRepository) {
	const record = (actor: Actor, action: string, targetType: string, targetId: string, detail?: string) =>
		audit.record(actor, { action, targetType, targetId, category: "email", detail: detail ?? null });

	async function orderedCategories(includeArchived: boolean) {
		return db
			.select()
			.from(emailCategories)
			.where(includeArchived ? undefined : isNull(emailCategories.archivedAt))
			.orderBy(asc(emailCategories.sortOrder), asc(emailCategories.name));
	}

	return {
		async listSenders(actor: Actor, opts?: { includeArchived?: boolean }): Promise<EmailSenderRow[]> {
			assertEmail(actor, "email:send");
			return db
				.select()
				.from(emailSenders)
				.where(opts?.includeArchived ? undefined : isNull(emailSenders.archivedAt))
				.orderBy(asc(emailSenders.displayName));
		},

		async saveSender(actor: Actor, input: { id?: string; address: string; displayName: string }): Promise<EmailSenderRow> {
			assertEmail(actor, "email:configure");
			const address = input.address.trim().toLowerCase();
			const displayName = input.displayName.trim();
			if (!isSendingAddress(address)) throw new Error(`Sender addresses must end in @${SENDING_DOMAIN}.`);
			if (!displayName) throw new Error("Add a display name.");
			const [clash] = await db.select({ id: emailSenders.id }).from(emailSenders).where(eq(emailSenders.address, address)).limit(1);
			if (clash && clash.id !== input.id) throw new Error("That address is already a sender.");
			const [row] = input.id
				? await db.update(emailSenders).set({ address, displayName }).where(eq(emailSenders.id, input.id)).returning()
				: await db.insert(emailSenders).values({ id: createId("esnd"), address, displayName }).returning();
			if (!row) throw new Error("Sender not found.");
			await record(actor, input.id ? "email:sender_update" : "email:sender_create", "email_sender", row.id, address);
			return row;
		},

		async setSenderArchived(actor: Actor, id: string, archived: boolean): Promise<void> {
			assertEmail(actor, "email:configure");
			await db.update(emailSenders).set({ archivedAt: archived ? new Date() : null }).where(eq(emailSenders.id, id));
			await record(actor, archived ? "email:sender_archive" : "email:sender_restore", "email_sender", id);
		},

		async listCategories(actor: Actor, opts?: { includeArchived?: boolean }): Promise<EmailCategoryRow[]> {
			assertEmail(actor, "email:send");
			return orderedCategories(Boolean(opts?.includeArchived));
		},

		async saveCategory(
			actor: Actor,
			input: { id?: string; name: string; description: string; required: boolean; defaultSenderId: string | null },
		): Promise<EmailCategoryRow> {
			assertEmail(actor, "email:configure");
			const name = input.name.trim();
			if (!name) throw new Error("Add a category name.");
			const values = { name, description: input.description.trim(), required: input.required, defaultSenderId: input.defaultSenderId };
			let row: EmailCategoryRow | undefined;
			if (input.id) {
				[row] = await db.update(emailCategories).set(values).where(eq(emailCategories.id, input.id)).returning();
			} else {
				const existing = await orderedCategories(true);
				const sortOrder = existing.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;
				[row] = await db.insert(emailCategories).values({ id: createId("ecat"), ...values, sortOrder }).returning();
			}
			if (!row) throw new Error("Category not found.");
			await record(actor, input.id ? "email:category_update" : "email:category_create", "email_category", row.id, `${name} (${input.required ? "required" : "optional"})`);
			return row;
		},

		async setCategoryArchived(actor: Actor, id: string, archived: boolean): Promise<void> {
			assertEmail(actor, "email:configure");
			await db.update(emailCategories).set({ archivedAt: archived ? new Date() : null }).where(eq(emailCategories.id, id));
			await record(actor, archived ? "email:category_archive" : "email:category_restore", "email_category", id);
		},

		async moveCategory(actor: Actor, id: string, direction: "up" | "down"): Promise<void> {
			assertEmail(actor, "email:configure");
			const list = await orderedCategories(false);
			const index = list.findIndex((c) => c.id === id);
			const swapWith = direction === "up" ? index - 1 : index + 1;
			if (index < 0 || swapWith < 0 || swapWith >= list.length) return;
			const reordered = [...list];
			[reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
			for (const [position, category] of reordered.entries()) {
				await db.update(emailCategories).set({ sortOrder: position }).where(eq(emailCategories.id, category.id));
			}
		},
	};
}
```

Create `src/db/repositories/email-guard.ts` (shared by every email repository):

```ts
import { can, type Actor } from "@/server/auth/permissions";

export function assertEmail(actor: Actor, action: "email:send" | "email:configure"): void {
	if (!can(actor, action)) {
		throw new Error(action === "email:configure" ? "Not authorized to manage email settings." : "Not authorized to send email.");
	}
}
```

- [ ] **Step 5: Implement `src/db/repositories/email-templates.ts`**

```ts
import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { emailCampaigns, emailCategories, emailTemplates } from "@/db/schema";
import { emailContentSchema } from "@/lib/email/blocks";
import { createId } from "@/lib/ids";
import type { EmailBlock } from "@/lib/email/types";
import type { Actor } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";
import type { EmailDb } from "./email-audience";
import { assertEmail } from "./email-guard";

export type EmailTemplateRow = InferSelectModel<typeof emailTemplates>;
export type TemplateListItem = EmailTemplateRow & { usedCount: number; categoryName: string | null };
export type TemplateInput = { id?: string; name: string; categoryId: string | null; subject: string; preheader: string; blocks: EmailBlock[] };

export function createEmailTemplatesRepository(db: EmailDb, audit: AuditRepository) {
	const record = (actor: Actor, action: string, targetId: string, detail?: string) =>
		audit.record(actor, { action, targetType: "email_template", targetId, category: "email", detail: detail ?? null });

	async function get(actor: Actor, id: string): Promise<EmailTemplateRow | null> {
		assertEmail(actor, "email:send");
		const [row] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id)).limit(1);
		return row ?? null;
	}

	async function save(actor: Actor, input: TemplateInput): Promise<EmailTemplateRow> {
		assertEmail(actor, "email:configure");
		const name = input.name.trim();
		if (!name) throw new Error("Add a template name.");
		const content = emailContentSchema.parse({ subject: input.subject, preheader: input.preheader, blocks: input.blocks });
		const values = { name, categoryId: input.categoryId, ...content, updatedBy: actor.memberId, updatedAt: new Date() };
		const [row] = input.id
			? await db.update(emailTemplates).set(values).where(eq(emailTemplates.id, input.id)).returning()
			: await db
					.insert(emailTemplates)
					.values({ id: createId("etpl"), ...values, createdBy: actor.memberId })
					.returning();
		if (!row) throw new Error("Template not found.");
		await record(actor, input.id ? "email:template_update" : "email:template_create", row.id, name);
		return row;
	}

	return {
		get,
		save,

		async list(actor: Actor, opts?: { q?: string; includeArchived?: boolean }): Promise<TemplateListItem[]> {
			assertEmail(actor, "email:send");
			const q = opts?.q?.trim();
			const rows = await db
				.select({ template: emailTemplates, categoryName: emailCategories.name })
				.from(emailTemplates)
				.leftJoin(emailCategories, eq(emailCategories.id, emailTemplates.categoryId))
				.where(
					and(
						opts?.includeArchived ? undefined : isNull(emailTemplates.archivedAt),
						q ? or(like(emailTemplates.name, `%${q}%`), like(emailTemplates.subject, `%${q}%`)) : undefined,
					),
				)
				.orderBy(desc(emailTemplates.updatedAt));
			const ids = rows.map((r) => r.template.id);
			const usage = ids.length
				? await db
						.select({ templateId: emailCampaigns.templateId, count: sql<number>`count(*)` })
						.from(emailCampaigns)
						.where(and(inArray(emailCampaigns.templateId, ids), inArray(emailCampaigns.status, ["sending", "sent"])))
						.groupBy(emailCampaigns.templateId)
				: [];
			const used = new Map(usage.map((u) => [u.templateId, Number(u.count)]));
			return rows.map((r) => ({ ...r.template, categoryName: r.categoryName, usedCount: used.get(r.template.id) ?? 0 }));
		},

		async duplicate(actor: Actor, id: string): Promise<EmailTemplateRow> {
			const source = await get(actor, id);
			if (!source) throw new Error("Template not found.");
			return save(actor, {
				name: `${source.name} (copy)`,
				categoryId: source.categoryId,
				subject: source.subject,
				preheader: source.preheader,
				blocks: source.blocks,
			});
		},

		async setArchived(actor: Actor, id: string, archived: boolean): Promise<void> {
			assertEmail(actor, "email:configure");
			await db.update(emailTemplates).set({ archivedAt: archived ? new Date() : null }).where(eq(emailTemplates.id, id));
			await record(actor, archived ? "email:template_archive" : "email:template_restore", id);
		},
	};
}
```

The `list` query includes `id` ordering by `updatedAt`. Two templates saved in the same millisecond may swap order, so the test sorts names before comparing.

- [ ] **Step 6: Implement `src/db/repositories/email.ts` and wire it**

```ts
import type { AuditRepository } from "./audit";
import type { EmailDb } from "./email-audience";
import { createEmailSettingsRepository } from "./email-settings";
import { createEmailTemplatesRepository } from "./email-templates";

export function createEmailRepositories(db: EmailDb, audit: AuditRepository) {
	return {
		settings: createEmailSettingsRepository(db, audit),
		templates: createEmailTemplatesRepository(db, audit),
	};
}

export type EmailRepositories = ReturnType<typeof createEmailRepositories>;

/** Shared-dev mode has no internal API for email; every call fails loudly. */
export function createUnavailableEmailRepositories(): EmailRepositories {
	const unavailable = () => {
		throw new Error("Email is unavailable through this repository adapter.");
	};
	const stub = new Proxy({}, { get: () => unavailable });
	return { settings: stub, templates: stub } as unknown as EmailRepositories;
}
```

`src/db/repositories/index.ts`:
- Import: `import { createEmailRepositories, createUnavailableEmailRepositories } from "./email";`
- In `createDrizzleRepositories` return object add `email: createEmailRepositories(d1, audit),` before `audit,`.
- In `createSharedRepositories` return object add `email: createUnavailableEmailRepositories(),` before `audit,`.

Later tasks add keys to the `return` in `createEmailRepositories` and to the stub object in `createUnavailableEmailRepositories`. Keep the two in sync.

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm exec vitest run src/lib/email/action-result.test.ts src/db/repositories/email-settings.integration.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/email/action-result.ts src/lib/email/action-result.test.ts src/db/repositories/email-guard.ts src/db/repositories/email-settings.ts src/db/repositories/email-templates.ts src/db/repositories/email.ts src/db/repositories/index.ts src/db/repositories/email-settings.integration.test.ts
git commit -m "feat(email): add sender, category, and template repositories"
```

---

### Task 8: Campaigns repository

**Files:**
- Create: `src/db/repositories/email-campaigns.ts`
- Modify: `src/db/repositories/email.ts` (add `campaigns`)
- Test: `src/db/repositories/email-campaigns.integration.test.ts`

**Interfaces:**
- Consumes: `resolveAudience`, `memberDisplayName`, `chunk`, `EmailDb` (Task 6); `assertEmail` (Task 7); `audienceSchema`, `emailContentSchema` (Task 3); `toLocalInput`, `startOfUtc8Day` (`src/lib/date-slots.ts`); `formatUtc8Time` for event snapshots.
- Produces:
  - `type EmailCampaignRow = InferSelectModel<typeof emailCampaigns>`
  - `type CampaignInput = { id?: string; templateId: string | null; categoryId: string | null; senderId: string | null; subject: string; preheader: string; blocks: EmailBlock[]; audience: Audience }`
  - `type AudiencePreview = { matched: number; willReceive: number; optedOut: { memberId: string; name: string }[]; recipients: { memberId: string; name: string; email: string }[] }` (`recipients` capped at 50)
  - `type AudienceOptions = { roles: { key: string; label: string }[]; batches: string[]; events: { id: string; title: string; startsAt: Date; place: string }[]; currentTermName: string | null }`
  - `type CampaignListItem = EmailCampaignRow & { categoryName: string | null; senderName: string | null }`
  - `type HomeSummary = { sending: CampaignListItem[]; scheduled: CampaignListItem[]; recent: CampaignListItem[]; drafts: CampaignListItem[]; sentThisMonth: number; sentToday: number }`
  - `type DeliveryRow = { id: string; memberId: string | null; email: string; name: string; status: EmailDeliveryStatus; attempts: number; error: string | null; sentAt: Date | null }`
  - `type CampaignReport = { campaign: CampaignListItem; counts: Record<EmailDeliveryStatus, number>; deliveries: DeliveryRow[] }`
  - `createEmailCampaignsRepository(db, audit)` with:
    - `get(actor, id): Promise<EmailCampaignRow | null>`
    - `saveDraft(actor, input: CampaignInput): Promise<EmailCampaignRow>`. Allowed only when the campaign is new, `draft`, or `scheduled`; saving a `scheduled` campaign returns it to `draft`.
    - `schedule(actor, id, at: Date, now?: Date): Promise<EmailCampaignRow>`. Draft only. Validates, snapshots event blocks, sets `scheduled`.
    - `unschedule(actor, id): Promise<void>`. Scheduled to draft.
    - `cancel(actor, id): Promise<void>`. Sending to cancelled, pending rows to cancelled.
    - `retryFailed(actor, id): Promise<number>`
    - `duplicate(actor, id): Promise<EmailCampaignRow>`
    - `previewAudience(actor, audience, categoryId: string | null, now?: Date): Promise<AudiencePreview>`
    - `audienceOptions(actor, now?: Date): Promise<AudienceOptions>`
    - `searchMembers(actor, query: string): Promise<{ id: string; name: string; email: string; batch: string | null }[]>`
    - `labelsFor(actor, ids: string[]): Promise<Record<string, string>>` (display names for hand-picked members)
    - `home(actor, now?: Date): Promise<HomeSummary>`
    - `report(actor, id, opts?: { status?: EmailDeliveryStatus; q?: string }): Promise<CampaignReport | null>`

- [ ] **Step 1: Write the failing test**

`src/db/repositories/email-campaigns.integration.test.ts`:

```ts
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { emailDeliveries } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createEmailRepositories } from "./email";

const db = drizzle(env.DB, { schema });
const repos = createEmailRepositories(db, createAuditRepository(db));
const admin: Actor = { memberId: "mem_admin", roles: ["email"] };
const NOW = new Date("2026-10-02T04:00:00Z");

async function setup() {
	for (const table of ["email_deliveries", "email_campaigns", "email_optouts", "email_templates", "email_categories", "email_senders", "audit_logs", "members"]) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
	for (const [id, batch] of [["mem_admin", "2026"], ["mem_a", "2027"], ["mem_b", "2027"]]) {
		await env.DB.prepare("INSERT INTO members (id, email, name, batch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
			.bind(id, `${id}@example.com`, id, batch, Date.now(), Date.now())
			.run();
	}
	const sender = await repos.settings.saveSender(admin, { address: "hello@ateneocode.org", displayName: "CODE" });
	const news = await repos.settings.saveCategory(admin, { name: "Newsletter", description: "", required: false, defaultSenderId: null });
	return { sender, news };
}

const draftInput = (ids: { sender: { id: string }; news: { id: string } }) => ({
	templateId: null,
	categoryId: ids.news.id,
	senderId: ids.sender.id,
	subject: "Hi {{first_name}}",
	preheader: "",
	blocks: [{ id: "t", type: "text" as const, props: { text: "Hello" } }],
	audience: { match: "any" as const, include: [{ kind: "batch" as const, batch: "2027" }], exclude: [] },
});

describe("email campaigns", () => {
	// Each test calls setup() itself because it needs the returned sender and category ids.

	it("previews the audience with opted-out members split out", async () => {
		const ids = await setup();
		await env.DB.prepare("INSERT INTO email_optouts (member_id, category_id, created_at) VALUES ('mem_b', ?, ?)").bind(ids.news.id, Date.now()).run();
		const preview = await repos.campaigns.previewAudience(admin, draftInput(ids).audience, ids.news.id, NOW);
		expect(preview.matched).toBe(2);
		expect(preview.willReceive).toBe(1);
		expect(preview.optedOut.map((m) => m.memberId)).toEqual(["mem_b"]);
	});

	it("schedules a valid draft once and refuses a second schedule", async () => {
		const ids = await setup();
		const draft = await repos.campaigns.saveDraft(admin, draftInput(ids));
		const at = new Date(NOW.getTime() + 2 * 60_000);
		const scheduled = await repos.campaigns.schedule(admin, draft.id, at, NOW);
		expect(scheduled.status).toBe("scheduled");
		await expect(repos.campaigns.schedule(admin, draft.id, at, NOW)).rejects.toThrow(/only drafts/i);
	});

	it("refuses to schedule without a sender, subject, content, or audience", async () => {
		const ids = await setup();
		const draft = await repos.campaigns.saveDraft(admin, { ...draftInput(ids), senderId: null });
		await expect(repos.campaigns.schedule(admin, draft.id, NOW, NOW)).rejects.toThrow(/sender/i);
		const empty = await repos.campaigns.saveDraft(admin, { ...draftInput(ids), audience: { match: "any", include: [], exclude: [] } });
		await expect(repos.campaigns.schedule(admin, empty.id, NOW, NOW)).rejects.toThrow(/audience/i);
	});

	it("refuses edits once sending, and unschedule returns to draft", async () => {
		const ids = await setup();
		const draft = await repos.campaigns.saveDraft(admin, draftInput(ids));
		await repos.campaigns.schedule(admin, draft.id, NOW, NOW);
		await repos.campaigns.unschedule(admin, draft.id);
		expect((await repos.campaigns.get(admin, draft.id))?.status).toBe("draft");
		await env.DB.prepare("UPDATE email_campaigns SET status='sending' WHERE id=?").bind(draft.id).run();
		await expect(repos.campaigns.saveDraft(admin, { ...draftInput(ids), id: draft.id })).rejects.toThrow(/can no longer be edited/i);
	});

	it("cancels a sending campaign and its pending deliveries", async () => {
		const ids = await setup();
		const draft = await repos.campaigns.saveDraft(admin, draftInput(ids));
		await env.DB.prepare("UPDATE email_campaigns SET status='sending' WHERE id=?").bind(draft.id).run();
		await env.DB.prepare("INSERT INTO email_deliveries (id, campaign_id, member_id, email, status, attempts) VALUES ('edl_1', ?, 'mem_a', 'a@x.com', 'pending', 0)")
			.bind(draft.id)
			.run();
		await repos.campaigns.cancel(admin, draft.id);
		expect((await repos.campaigns.get(admin, draft.id))?.status).toBe("cancelled");
		const [row] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, "edl_1"));
		expect(row.status).toBe("cancelled");
	});

	it("retries only failed deliveries", async () => {
		const ids = await setup();
		const draft = await repos.campaigns.saveDraft(admin, draftInput(ids));
		await env.DB.prepare("UPDATE email_campaigns SET status='sent' WHERE id=?").bind(draft.id).run();
		await env.DB.prepare(
			"INSERT INTO email_deliveries (id, campaign_id, member_id, email, status, attempts, error) VALUES ('edl_f', ?, 'mem_a', 'a@x.com', 'failed', 3, 'boom'), ('edl_s', ?, 'mem_b', 'b@x.com', 'sent', 1, NULL)",
		)
			.bind(draft.id, draft.id)
			.run();
		expect(await repos.campaigns.retryFailed(admin, draft.id)).toBe(1);
		const rows = await db.select().from(emailDeliveries);
		expect(rows.find((r) => r.id === "edl_f")).toMatchObject({ status: "pending", attempts: 0, error: null });
		expect(rows.find((r) => r.id === "edl_s")?.status).toBe("sent");
		expect((await repos.campaigns.get(admin, draft.id))?.status).toBe("sending");
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/db/repositories/email-campaigns.integration.test.ts`
Expected: FAIL, `repos.campaigns` is undefined.

- [ ] **Step 3: Implement `src/db/repositories/email-campaigns.ts`**

```ts
import { and, asc, desc, eq, gte, inArray, isNull, like, or, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { crsEvents, emailCampaigns, emailCategories, emailDeliveries, emailOptouts, emailSenders, members, roles, terms } from "@/db/schema";
import { audienceSchema, emailContentSchema } from "@/lib/email/blocks";
import { startOfUtc8Day } from "@/lib/date-slots";
import { createId } from "@/lib/ids";
import type { Audience, EmailBlock, EmailDeliveryStatus } from "@/lib/email/types";
import type { Actor } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";
import { chunk, memberDisplayName, resolveAudience, type EmailDb } from "./email-audience";
import { assertEmail } from "./email-guard";

export type EmailCampaignRow = InferSelectModel<typeof emailCampaigns>;
export type CampaignInput = {
	id?: string;
	templateId: string | null;
	categoryId: string | null;
	senderId: string | null;
	subject: string;
	preheader: string;
	blocks: EmailBlock[];
	audience: Audience;
};
export type AudiencePreview = {
	matched: number;
	willReceive: number;
	optedOut: { memberId: string; name: string }[];
	recipients: { memberId: string; name: string; email: string }[];
};
export type AudienceOptions = {
	roles: { key: string; label: string }[];
	batches: string[];
	events: { id: string; title: string; startsAt: Date; place: string }[];
	currentTermName: string | null;
};
export type CampaignListItem = EmailCampaignRow & { categoryName: string | null; senderName: string | null };
export type HomeSummary = {
	sending: CampaignListItem[];
	scheduled: CampaignListItem[];
	recent: CampaignListItem[];
	drafts: CampaignListItem[];
	sentThisMonth: number;
	sentToday: number;
};
export type DeliveryRow = {
	id: string;
	memberId: string | null;
	email: string;
	name: string;
	status: EmailDeliveryStatus;
	attempts: number;
	error: string | null;
	sentAt: Date | null;
};
export type CampaignReport = { campaign: CampaignListItem; counts: Record<EmailDeliveryStatus, number>; deliveries: DeliveryRow[] };

const EVENT_WHEN = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const formatEventWhen = (date: Date) => EVENT_WHEN.format(date);

const ZERO_COUNTS: Record<EmailDeliveryStatus, number> = { pending: 0, sent: 0, failed: 0, skipped_optout: 0, cancelled: 0 };

export function createEmailCampaignsRepository(db: EmailDb, audit: AuditRepository) {
	const record = (actor: Actor, action: string, targetId: string, detail?: string) =>
		audit.record(actor, { action, targetType: "email_campaign", targetId, category: "email", detail: detail ?? null });

	const listQuery = () =>
		db
			.select({ campaign: emailCampaigns, categoryName: emailCategories.name, senderName: emailSenders.displayName })
			.from(emailCampaigns)
			.leftJoin(emailCategories, eq(emailCategories.id, emailCampaigns.categoryId))
			.leftJoin(emailSenders, eq(emailSenders.id, emailCampaigns.senderId));
	const flatten = (rows: { campaign: EmailCampaignRow; categoryName: string | null; senderName: string | null }[]): CampaignListItem[] =>
		rows.map((r) => ({ ...r.campaign, categoryName: r.categoryName, senderName: r.senderName }));

	async function get(actor: Actor, id: string): Promise<EmailCampaignRow | null> {
		assertEmail(actor, "email:send");
		const [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id)).limit(1);
		return row ?? null;
	}

	async function snapshotEvents(blocks: EmailBlock[]): Promise<EmailBlock[]> {
		const ids = blocks.flatMap((b) => (b.type === "event" ? [b.props.eventId] : []));
		if (ids.length === 0) return blocks;
		const rows = await db
			.select({ id: crsEvents.id, title: crsEvents.title, startsAt: crsEvents.startsAt, place: crsEvents.place })
			.from(crsEvents)
			.where(and(inArray(crsEvents.id, ids), isNull(crsEvents.deletedAt)));
		const byId = new Map(rows.map((r) => [r.id, r]));
		return blocks.map((block) => {
			if (block.type !== "event") return block;
			const event = byId.get(block.props.eventId);
			if (!event) throw new Error("An event in this email was deleted. Remove that block and try again.");
			return { ...block, props: { ...block.props, title: event.title, when: formatEventWhen(event.startsAt), place: event.place } };
		});
	}

	async function optedOutIds(categoryId: string | null): Promise<Set<string>> {
		if (!categoryId) return new Set();
		const [category] = await db.select({ required: emailCategories.required }).from(emailCategories).where(eq(emailCategories.id, categoryId)).limit(1);
		if (!category || category.required) return new Set();
		const rows = await db.select({ memberId: emailOptouts.memberId }).from(emailOptouts).where(eq(emailOptouts.categoryId, categoryId));
		return new Set(rows.map((r) => r.memberId));
	}

	return {
		get,

		async saveDraft(actor: Actor, input: CampaignInput): Promise<EmailCampaignRow> {
			assertEmail(actor, "email:send");
			const content = emailContentSchema.parse({ subject: input.subject, preheader: input.preheader, blocks: input.blocks });
			const audience = audienceSchema.parse(input.audience);
			const values = { templateId: input.templateId, categoryId: input.categoryId, senderId: input.senderId, ...content, audience, updatedAt: new Date() };
			if (!input.id) {
				const [row] = await db
					.insert(emailCampaigns)
					.values({ id: createId("ecmp"), ...values, createdBy: actor.memberId })
					.returning();
				await record(actor, "email:campaign_create", row.id, content.subject);
				return row;
			}
			const [row] = await db
				.update(emailCampaigns)
				.set({ ...values, status: "draft", scheduledAt: null })
				.where(and(eq(emailCampaigns.id, input.id), inArray(emailCampaigns.status, ["draft", "scheduled"])))
				.returning();
			if (!row) throw new Error("This email can no longer be edited. Duplicate it to send a new version.");
			return row;
		},

		async schedule(actor: Actor, id: string, at: Date, now = new Date()): Promise<EmailCampaignRow> {
			assertEmail(actor, "email:send");
			const campaign = await get(actor, id);
			if (!campaign) throw new Error("Email not found.");
			if (campaign.status !== "draft") throw new Error("Only drafts can be scheduled.");
			if (!campaign.senderId) throw new Error("Pick a sender before sending.");
			const [sender] = await db.select().from(emailSenders).where(eq(emailSenders.id, campaign.senderId)).limit(1);
			if (!sender || sender.archivedAt) throw new Error("The chosen sender is archived. Pick another sender.");
			if (!campaign.categoryId) throw new Error("Pick a category before sending.");
			const [category] = await db.select().from(emailCategories).where(eq(emailCategories.id, campaign.categoryId)).limit(1);
			if (!category || category.archivedAt) throw new Error("The chosen category is archived. Pick another category.");
			if (!campaign.subject.trim()) throw new Error("Add a subject before sending.");
			if (campaign.blocks.length === 0) throw new Error("Add content before sending.");
			if (campaign.audience.include.length === 0) throw new Error("Choose an audience before sending.");
			if (at.getTime() < now.getTime() - 60_000) throw new Error("Pick a time in the future.");
			const blocks = await snapshotEvents(campaign.blocks);
			const [row] = await db
				.update(emailCampaigns)
				.set({ status: "scheduled", scheduledAt: at, blocks, updatedAt: now })
				.where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.status, "draft")))
				.returning();
			if (!row) throw new Error("Only drafts can be scheduled.");
			await record(actor, "email:campaign_schedule", id, at.toISOString());
			return row;
		},

		async unschedule(actor: Actor, id: string): Promise<void> {
			assertEmail(actor, "email:send");
			const rows = await db
				.update(emailCampaigns)
				.set({ status: "draft", scheduledAt: null, updatedAt: new Date() })
				.where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.status, "scheduled")))
				.returning({ id: emailCampaigns.id });
			if (rows.length === 0) throw new Error("This email has already started sending.");
			await record(actor, "email:campaign_unschedule", id);
		},

		async cancel(actor: Actor, id: string): Promise<void> {
			assertEmail(actor, "email:send");
			const rows = await db
				.update(emailCampaigns)
				.set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
				.where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.status, "sending")))
				.returning({ id: emailCampaigns.id });
			if (rows.length === 0) throw new Error("Only an email that is sending can be cancelled.");
			// ponytail: a delivery already picked by the running cron tick can still go out; the window is one batch.
			await db
				.update(emailDeliveries)
				.set({ status: "cancelled" })
				.where(and(eq(emailDeliveries.campaignId, id), eq(emailDeliveries.status, "pending")));
			await record(actor, "email:campaign_cancel", id);
		},

		async retryFailed(actor: Actor, id: string): Promise<number> {
			assertEmail(actor, "email:send");
			const campaign = await get(actor, id);
			if (!campaign || !["sent", "failed"].includes(campaign.status)) throw new Error("Only finished emails can retry failed recipients.");
			const reset = await db
				.update(emailDeliveries)
				.set({ status: "pending", attempts: 0, error: null, nextAttemptAt: null })
				.where(and(eq(emailDeliveries.campaignId, id), eq(emailDeliveries.status, "failed")))
				.returning({ id: emailDeliveries.id });
			if (reset.length > 0) {
				await db.update(emailCampaigns).set({ status: "sending", finishedAt: null, updatedAt: new Date() }).where(eq(emailCampaigns.id, id));
				await record(actor, "email:campaign_retry", id, `${reset.length} recipients`);
			}
			return reset.length;
		},

		async duplicate(actor: Actor, id: string): Promise<EmailCampaignRow> {
			const source = await get(actor, id);
			if (!source) throw new Error("Email not found.");
			const [row] = await db
				.insert(emailCampaigns)
				.values({
					id: createId("ecmp"),
					templateId: source.templateId,
					categoryId: source.categoryId,
					senderId: source.senderId,
					subject: source.subject,
					preheader: source.preheader,
					blocks: source.blocks,
					audience: source.audience,
					createdBy: actor.memberId,
				})
				.returning();
			await record(actor, "email:campaign_duplicate", row.id, `from ${id}`);
			return row;
		},

		async previewAudience(actor: Actor, audience: Audience, categoryId: string | null, now = new Date()): Promise<AudiencePreview> {
			assertEmail(actor, "email:send");
			const recipients = await resolveAudience(db, audienceSchema.parse(audience), now);
			const optedOut = await optedOutIds(categoryId);
			const receiving = recipients.filter((r) => !optedOut.has(r.memberId));
			return {
				matched: recipients.length,
				willReceive: receiving.length,
				optedOut: recipients.filter((r) => optedOut.has(r.memberId)).map((r) => ({ memberId: r.memberId, name: memberDisplayName(r) })),
				recipients: receiving.slice(0, 50).map((r) => ({ memberId: r.memberId, name: memberDisplayName(r), email: r.email })),
			};
		},

		async audienceOptions(actor: Actor, now = new Date()): Promise<AudienceOptions> {
			assertEmail(actor, "email:send");
			const [roleRows, batchRows, eventRows, termRows] = await Promise.all([
				db.select({ key: roles.key, label: roles.label }).from(roles).orderBy(asc(roles.label)),
				db.selectDistinct({ batch: members.batch }).from(members).orderBy(desc(members.batch)),
				db
					.select({ id: crsEvents.id, title: crsEvents.title, startsAt: crsEvents.startsAt, place: crsEvents.place })
					.from(crsEvents)
					.where(isNull(crsEvents.deletedAt))
					.orderBy(desc(crsEvents.startsAt))
					.limit(60),
				db
					.select({ name: terms.name })
					.from(terms)
					.where(and(sql`${terms.startsAt} <= ${now.getTime()}`, sql`${terms.endsAt} >= ${now.getTime()}`))
					.limit(1),
			]);
			return {
				roles: roleRows.filter((r) => r.key !== "member"),
				batches: batchRows.map((r) => r.batch).filter((b): b is string => Boolean(b)),
				events: eventRows,
				currentTermName: termRows[0]?.name ?? null,
			};
		},

		async searchMembers(actor: Actor, query: string) {
			assertEmail(actor, "email:send");
			const q = query.trim();
			if (q.length < 2) return [];
			const pattern = `%${q}%`;
			const rows = await db
				.select({ id: members.id, email: members.email, name: members.name, fullName: members.fullName, nickname: members.nickname, batch: members.batch })
				.from(members)
				.where(or(like(members.name, pattern), like(members.fullName, pattern), like(members.nickname, pattern), like(members.email, pattern)))
				.limit(12);
			return rows.map((r) => ({ id: r.id, name: memberDisplayName(r), email: r.email, batch: r.batch }));
		},

		async labelsFor(actor: Actor, ids: string[]): Promise<Record<string, string>> {
			assertEmail(actor, "email:send");
			const labels: Record<string, string> = {};
			for (const part of chunk(ids, 90)) {
				const rows = await db
					.select({ id: members.id, email: members.email, name: members.name, fullName: members.fullName, nickname: members.nickname })
					.from(members)
					.where(inArray(members.id, part));
				for (const row of rows) labels[row.id] = memberDisplayName(row);
			}
			return labels;
		},

		async home(actor: Actor, now = new Date()): Promise<HomeSummary> {
			assertEmail(actor, "email:send");
			const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
			const [sending, scheduled, recent, drafts, [month], [today]] = await Promise.all([
				listQuery().where(eq(emailCampaigns.status, "sending")).orderBy(asc(emailCampaigns.startedAt)),
				listQuery().where(eq(emailCampaigns.status, "scheduled")).orderBy(asc(emailCampaigns.scheduledAt)),
				listQuery()
					.where(inArray(emailCampaigns.status, ["sent", "failed", "cancelled"]))
					.orderBy(desc(emailCampaigns.finishedAt))
					.limit(5),
				listQuery().where(eq(emailCampaigns.status, "draft")).orderBy(desc(emailCampaigns.updatedAt)).limit(10),
				db
					.select({ n: sql<number>`count(*)` })
					.from(emailDeliveries)
					.where(and(eq(emailDeliveries.status, "sent"), gte(emailDeliveries.sentAt, monthStart))),
				db
					.select({ n: sql<number>`count(*)` })
					.from(emailDeliveries)
					.where(and(eq(emailDeliveries.status, "sent"), gte(emailDeliveries.sentAt, startOfUtc8Day(now)))),
			]);
			return {
				sending: flatten(sending),
				scheduled: flatten(scheduled),
				recent: flatten(recent),
				drafts: flatten(drafts),
				sentThisMonth: Number(month?.n ?? 0),
				sentToday: Number(today?.n ?? 0),
			};
		},

		async report(actor: Actor, id: string, opts?: { status?: EmailDeliveryStatus; q?: string }): Promise<CampaignReport | null> {
			assertEmail(actor, "email:send");
			const [campaignRow] = await listQuery().where(eq(emailCampaigns.id, id)).limit(1);
			if (!campaignRow) return null;
			const countRows = await db
				.select({ status: emailDeliveries.status, n: sql<number>`count(*)` })
				.from(emailDeliveries)
				.where(eq(emailDeliveries.campaignId, id))
				.groupBy(emailDeliveries.status);
			const counts = { ...ZERO_COUNTS };
			for (const row of countRows) counts[row.status] = Number(row.n);
			const q = opts?.q?.trim();
			const rows = await db
				.select({ delivery: emailDeliveries, name: members.name, fullName: members.fullName, nickname: members.nickname })
				.from(emailDeliveries)
				.leftJoin(members, eq(members.id, emailDeliveries.memberId))
				.where(
					and(
						eq(emailDeliveries.campaignId, id),
						opts?.status ? eq(emailDeliveries.status, opts.status) : undefined,
						q ? or(like(emailDeliveries.email, `%${q}%`), like(members.name, `%${q}%`), like(members.fullName, `%${q}%`)) : undefined,
					),
				)
				.orderBy(asc(emailDeliveries.email))
				.limit(500);
			return {
				campaign: flatten([campaignRow])[0],
				counts,
				deliveries: rows.map((r) => ({
					id: r.delivery.id,
					memberId: r.delivery.memberId,
					email: r.delivery.email,
					name: memberDisplayName({ email: r.delivery.email, name: r.name, fullName: r.fullName, nickname: r.nickname }),
					status: r.delivery.status,
					attempts: r.delivery.attempts,
					error: r.delivery.error,
					sentAt: r.delivery.sentAt,
				})),
			};
		},
	};
}
```

In `src/db/repositories/email.ts`, import `createEmailCampaignsRepository` and add `campaigns: createEmailCampaignsRepository(db, audit),` to the returned object, and `campaigns: stub,` to the unavailable object.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm exec vitest run src/db/repositories/email-campaigns.integration.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/email-campaigns.ts src/db/repositories/email-campaigns.integration.test.ts src/db/repositories/email.ts
git commit -m "feat(email): add campaign drafts, scheduling, cancel, retry, preview, and reports"
```

---

### Task 9: Sender seam and cron dispatcher

**Files:**
- Create: `src/server/email/sender.ts`
- Create: `src/server/email/dispatch.ts`
- Test: `src/server/email/dispatch.integration.test.ts`

**Interfaces:**
- Consumes: `resolveAudience`, `chunk`, `EmailDb` (Task 6); `renderEmail`, `valueResolver` (Task 4); `mergeValuesFor` (Task 3); `signUnsubscribeToken` (Task 5); `EmailConfig`, `plusAddress` (Task 1); `startOfUtc8Day`.
- Produces:
  - `type OutgoingEmail = { to: string; from: { email: string; name: string }; replyTo: string; subject: string; html: string; text: string; headers?: Record<string, string> }`
  - `type EmailSender = { send(message: OutgoingEmail): Promise<{ messageId: string }> }`
  - `class EmailQuotaError extends Error`
  - `bindingSender(binding: { send(message: unknown): Promise<{ messageId: string }> }): EmailSender`
  - `runEmailDispatch(db: EmailDb, sender: EmailSender, config: EmailConfig, now?: Date): Promise<DispatchResult>`
  - `type DispatchResult = { claimed: number; sent: number; failed: number; paused: boolean }`
  - `unsubscribeLinks(config: EmailConfig, memberId: string, categoryId: string): Promise<{ page: string; oneClick: string }>`

- [ ] **Step 1: Write the failing test**

`src/server/email/dispatch.integration.test.ts`:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { emailCampaigns, emailDeliveries } from "@/db/schema";
import type { EmailConfig } from "./config";
import { runEmailDispatch } from "./dispatch";
import { EmailQuotaError, type EmailSender, type OutgoingEmail } from "./sender";

const db = drizzle(env.DB, { schema });
const NOW = new Date("2026-10-02T04:00:00Z");
const config: EmailConfig = {
	inboxAddress: "beta-inbox@ateneocode.org",
	publicBaseUrl: "https://beta.ateneocode.org",
	unsubscribeSecret: "test-unsubscribe-secret-0123456789",
	batchPerTick: 25,
	dailyCap: 300,
};

function fakeSender(fail: (message: OutgoingEmail) => Error | null = () => null) {
	const sent: OutgoingEmail[] = [];
	const sender: EmailSender = {
		async send(message) {
			const error = fail(message);
			if (error) throw error;
			sent.push(message);
			return { messageId: `msg-${sent.length}` };
		},
	};
	return { sender, sent };
}

async function seed(opts: { required?: boolean } = {}) {
	for (const table of ["email_deliveries", "email_campaigns", "email_optouts", "email_categories", "email_senders", "members"]) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
	for (const id of ["mem_a", "mem_b", "mem_c"]) {
		await env.DB.prepare("INSERT INTO members (id, email, name, full_name, batch, created_at, updated_at) VALUES (?, ?, ?, ?, '2027', ?, ?)")
			.bind(id, `${id}@example.com`, id, `${id.toUpperCase()} Person`, Date.now(), Date.now())
			.run();
	}
	await env.DB.prepare("INSERT INTO email_senders (id, address, display_name, created_at) VALUES ('esnd_1', 'hello@ateneocode.org', 'CODE', ?)").bind(Date.now()).run();
	await env.DB.prepare("INSERT INTO email_categories (id, name, description, required, sort_order, created_at) VALUES ('ecat_1', 'Newsletter', '', ?, 0, ?)")
		.bind(opts.required ? 1 : 0, Date.now())
		.run();
	await env.DB.prepare("INSERT INTO email_optouts (member_id, category_id, created_at) VALUES ('mem_c', 'ecat_1', ?)").bind(Date.now()).run();
	await db.insert(emailCampaigns).values({
		id: "ecmp_1",
		categoryId: "ecat_1",
		senderId: "esnd_1",
		subject: "Hi {{first_name}}",
		preheader: "",
		blocks: [{ id: "t", type: "text", props: { text: "Hello {{first_name}}" } }],
		audience: { match: "any", include: [{ kind: "batch", batch: "2027" }], exclude: [] },
		status: "scheduled",
		scheduledAt: new Date(NOW.getTime() - 1000),
	});
}

const deliveries = () => db.select().from(emailDeliveries);
const campaign = async () => (await db.select().from(emailCampaigns))[0];

describe("runEmailDispatch", () => {
	beforeEach(() => seed());

	it("claims a due campaign, skips opted-out members, sends, and finishes", async () => {
		const { sender, sent } = fakeSender();
		const result = await runEmailDispatch(db, sender, config, NOW);
		expect(result).toMatchObject({ claimed: 1, sent: 2, failed: 0 });
		expect(sent.map((m) => m.to).sort()).toEqual(["mem_a@example.com", "mem_b@example.com"]);
		expect(sent[0].subject).toMatch(/^Hi MEM_/);
		expect(sent[0].replyTo).toMatch(/^beta-inbox\+edl_[a-f0-9]+@ateneocode\.org$/);
		expect(sent[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
		expect(sent[0].headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/beta\.ateneocode\.org\/api\/email\/unsubscribe\?t=/);
		const rows = await deliveries();
		expect(rows.find((r) => r.memberId === "mem_c")?.status).toBe("skipped_optout");
		expect(await campaign()).toMatchObject({ status: "sent", sentCount: 2, skippedCount: 1, recipientCount: 3 });
	});

	it("sends to opted-out members when the category is required, with no unsubscribe header", async () => {
		await seed({ required: true });
		const { sender, sent } = fakeSender();
		await runEmailDispatch(db, sender, config, NOW);
		expect(sent).toHaveLength(3);
		expect(sent[0].headers?.["List-Unsubscribe"]).toBeUndefined();
	});

	it("never double-sends when two ticks run at once", async () => {
		const { sender, sent } = fakeSender();
		await Promise.all([runEmailDispatch(db, sender, config, NOW), runEmailDispatch(db, sender, config, NOW)]);
		expect(sent.map((m) => m.to).sort()).toEqual(["mem_a@example.com", "mem_b@example.com"]);
		expect((await deliveries()).length).toBe(3);
	});

	it("backs off on failure and fails after three attempts", async () => {
		const { sender } = fakeSender((m) => (m.to.startsWith("mem_a") ? new Error("mailbox unavailable") : null));
		await runEmailDispatch(db, sender, config, NOW);
		let row = (await deliveries()).find((r) => r.memberId === "mem_a")!;
		expect(row).toMatchObject({ status: "pending", attempts: 1, error: "mailbox unavailable" });
		expect(row.nextAttemptAt?.getTime()).toBe(NOW.getTime() + 60_000);
		await runEmailDispatch(db, sender, config, new Date(NOW.getTime() + 61_000));
		await runEmailDispatch(db, sender, config, new Date(NOW.getTime() + 61_000 + 5 * 60_000 + 1000));
		row = (await deliveries()).find((r) => r.memberId === "mem_a")!;
		expect(row).toMatchObject({ status: "failed", attempts: 3 });
		expect((await campaign()).status).toBe("sent");
	});

	it("pauses on a quota error without spending an attempt", async () => {
		const { sender } = fakeSender(() => new EmailQuotaError("daily limit"));
		const result = await runEmailDispatch(db, sender, config, NOW);
		expect(result.paused).toBe(true);
		expect((await deliveries()).filter((r) => r.status === "pending").every((r) => r.attempts === 0)).toBe(true);
		expect((await campaign()).status).toBe("sending");
	});

	it("respects the daily cap", async () => {
		const { sender, sent } = fakeSender();
		await runEmailDispatch(db, sender, { ...config, dailyCap: 1 }, NOW);
		expect(sent).toHaveLength(1);
	});

	it("does nothing before the scheduled time", async () => {
		const { sender, sent } = fakeSender();
		const result = await runEmailDispatch(db, sender, config, new Date(NOW.getTime() - 60_000));
		expect(result.claimed).toBe(0);
		expect(sent).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/server/email/dispatch.integration.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/server/email/sender.ts`**

```ts
export type OutgoingEmail = {
	to: string;
	from: { email: string; name: string };
	replyTo: string;
	subject: string;
	html: string;
	text: string;
	headers?: Record<string, string>;
};

export type EmailSender = { send(message: OutgoingEmail): Promise<{ messageId: string }> };

/** Account quota or rate limit. The dispatcher stops for this tick and keeps the attempt. */
export class EmailQuotaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EmailQuotaError";
	}
}

/** Wraps the Workers `send_email` binding. The binding throws an Error with a `code` property. */
export function bindingSender(binding: { send(message: unknown): Promise<{ messageId: string }> }): EmailSender {
	return {
		async send(message) {
			try {
				return await binding.send(message);
			} catch (error) {
				const code = String((error as { code?: unknown })?.code ?? "");
				const text = error instanceof Error ? error.message : String(error);
				if (/RATE|QUOTA|LIMIT/i.test(code) || /rate limit|quota|daily limit/i.test(text)) throw new EmailQuotaError(text);
				throw error instanceof Error ? error : new Error(text);
			}
		},
	};
}
```

- [ ] **Step 4: Implement `src/server/email/dispatch.ts`**

```ts
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { emailCampaigns, emailCategories, emailDeliveries, emailOptouts, emailSenders, members } from "@/db/schema";
import { chunk, resolveAudience, type EmailDb } from "@/db/repositories/email-audience";
import { startOfUtc8Day } from "@/lib/date-slots";
import { createId } from "@/lib/ids";
import { mergeValuesFor } from "@/lib/email/merge";
import { renderEmail, valueResolver } from "@/lib/email/render";
import type { Audience } from "@/lib/email/types";
import { plusAddress, type EmailConfig } from "./config";
import { EmailQuotaError, type EmailSender } from "./sender";
import { signUnsubscribeToken } from "./unsubscribe-token";

export type DispatchResult = { claimed: number; sent: number; failed: number; paused: boolean };

const BACKOFF_MINUTES = [1, 5, 15];
const MAX_ATTEMPTS = 3;
// A delivery insert binds 5 columns; 15 rows stays under D1's 100-parameter limit.
const INSERT_CHUNK = 15;
const ID_CHUNK = 90;

export async function unsubscribeLinks(config: EmailConfig, memberId: string, categoryId: string) {
	const token = await signUnsubscribeToken(config.unsubscribeSecret, memberId, categoryId);
	return {
		page: `${config.publicBaseUrl}/unsubscribe?t=${token}`,
		oneClick: `${config.publicBaseUrl}/api/email/unsubscribe?t=${token}`,
	};
}

async function enqueue(db: EmailDb, campaign: { id: string; audience: Audience; categoryId: string | null }, now: Date) {
	const recipients = await resolveAudience(db, campaign.audience, now);
	const [category] = campaign.categoryId
		? await db.select({ required: emailCategories.required }).from(emailCategories).where(eq(emailCategories.id, campaign.categoryId)).limit(1)
		: [];
	const optedOut =
		category && !category.required && campaign.categoryId
			? new Set(
					(await db.select({ memberId: emailOptouts.memberId }).from(emailOptouts).where(eq(emailOptouts.categoryId, campaign.categoryId))).map(
						(r) => r.memberId,
					),
				)
			: new Set<string>();
	const rows = recipients.map((r) => ({
		id: createId("edl"),
		campaignId: campaign.id,
		memberId: r.memberId,
		email: r.email,
		status: optedOut.has(r.memberId) ? ("skipped_optout" as const) : ("pending" as const),
	}));
	for (const part of chunk(rows, INSERT_CHUNK)) await db.insert(emailDeliveries).values(part).onConflictDoNothing();
}

async function claimDueCampaigns(db: EmailDb, now: Date): Promise<number> {
	const due = await db
		.select({ id: emailCampaigns.id, audience: emailCampaigns.audience, categoryId: emailCampaigns.categoryId })
		.from(emailCampaigns)
		.where(and(eq(emailCampaigns.status, "scheduled"), lte(emailCampaigns.scheduledAt, now)));
	let claimed = 0;
	for (const campaign of due) {
		// The conditional update is the lock: only the tick that flips the row enqueues it.
		const flipped = await db
			.update(emailCampaigns)
			.set({ status: "sending", startedAt: now, updatedAt: now })
			.where(and(eq(emailCampaigns.id, campaign.id), eq(emailCampaigns.status, "scheduled")))
			.returning({ id: emailCampaigns.id });
		if (flipped.length === 0) continue;
		claimed++;
		await enqueue(db, campaign, now);
	}
	return claimed;
}

async function drain(db: EmailDb, sender: EmailSender, config: EmailConfig, now: Date) {
	const [{ n: sentToday }] = await db
		.select({ n: sql<number>`count(*)` })
		.from(emailDeliveries)
		.where(and(eq(emailDeliveries.status, "sent"), gte(emailDeliveries.sentAt, startOfUtc8Day(now))));
	const budget = Math.min(config.batchPerTick, config.dailyCap - Number(sentToday));
	if (budget <= 0) return { sent: 0, failed: 0, paused: true };

	const due = await db
		.select({ delivery: emailDeliveries })
		.from(emailDeliveries)
		.innerJoin(emailCampaigns, eq(emailCampaigns.id, emailDeliveries.campaignId))
		.where(
			and(
				eq(emailDeliveries.status, "pending"),
				eq(emailCampaigns.status, "sending"),
				or(isNull(emailDeliveries.nextAttemptAt), lte(emailDeliveries.nextAttemptAt, now)),
			),
		)
		.orderBy(asc(emailCampaigns.startedAt), asc(emailDeliveries.id))
		.limit(budget);
	if (due.length === 0) return { sent: 0, failed: 0, paused: false };

	const campaignIds = [...new Set(due.map((d) => d.delivery.campaignId))];
	const campaignRows = await db
		.select({ campaign: emailCampaigns, category: emailCategories, sender: emailSenders })
		.from(emailCampaigns)
		.leftJoin(emailCategories, eq(emailCategories.id, emailCampaigns.categoryId))
		.leftJoin(emailSenders, eq(emailSenders.id, emailCampaigns.senderId))
		.where(inArray(emailCampaigns.id, campaignIds));
	const campaigns = new Map(campaignRows.map((r) => [r.campaign.id, r]));

	const memberIds = due.map((d) => d.delivery.memberId).filter((id): id is string => id !== null);
	const memberRows = [];
	for (const part of chunk(memberIds, ID_CHUNK)) {
		memberRows.push(
			...(await db
				.select({ id: members.id, email: members.email, name: members.name, fullName: members.fullName, nickname: members.nickname, batch: members.batch })
				.from(members)
				.where(inArray(members.id, part))),
		);
	}
	const memberById = new Map(memberRows.map((m) => [m.id, m]));

	let sent = 0;
	let failed = 0;
	for (const { delivery } of due) {
		const entry = campaigns.get(delivery.campaignId);
		const fail = async (message: string, final: boolean) => {
			const attempts = delivery.attempts + 1;
			const done = final || attempts >= MAX_ATTEMPTS;
			await db
				.update(emailDeliveries)
				.set({
					attempts,
					error: message,
					status: done ? "failed" : "pending",
					nextAttemptAt: done ? null : new Date(now.getTime() + BACKOFF_MINUTES[attempts - 1] * 60_000),
				})
				.where(eq(emailDeliveries.id, delivery.id));
			if (done) failed++;
		};
		if (!entry?.sender || !entry.category) {
			await fail("The sender or category for this email no longer exists.", true);
			continue;
		}
		const member = delivery.memberId ? memberById.get(delivery.memberId) : undefined;
		const values = mergeValuesFor(member ?? { email: delivery.email, name: null, fullName: null, nickname: null, batch: null });
		const links =
			!entry.category.required && delivery.memberId ? await unsubscribeLinks(config, delivery.memberId, entry.category.id) : null;
		const rendered = renderEmail({
			subject: entry.campaign.subject,
			preheader: entry.campaign.preheader,
			blocks: entry.campaign.blocks,
			resolve: valueResolver(values),
			values,
			baseUrl: config.publicBaseUrl,
			footer: {
				categoryName: entry.category.name,
				required: entry.category.required,
				archiveUrl: `${config.publicBaseUrl}/portal/mail/${delivery.id}`,
				preferencesUrl: `${config.publicBaseUrl}/portal/mail/preferences`,
				unsubscribeUrl: links?.page ?? null,
			},
		});
		const headers: Record<string, string> = { "X-CODE-Campaign": entry.campaign.id };
		if (links) {
			headers["List-Unsubscribe"] = `<${links.oneClick}>`;
			headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
		}
		try {
			const result = await sender.send({
				to: delivery.email,
				from: { email: entry.sender.address, name: entry.sender.displayName },
				replyTo: plusAddress(config.inboxAddress, delivery.id),
				subject: rendered.subject,
				html: rendered.html,
				text: rendered.text,
				headers,
			});
			await db
				.update(emailDeliveries)
				.set({ status: "sent", messageId: result.messageId, sentAt: now, attempts: delivery.attempts + 1, error: null, nextAttemptAt: null })
				.where(eq(emailDeliveries.id, delivery.id));
			sent++;
		} catch (error) {
			if (error instanceof EmailQuotaError) return { sent, failed, paused: true };
			await fail(error instanceof Error ? error.message : String(error), false);
		}
	}
	return { sent, failed, paused: false };
}

async function finish(db: EmailDb, now: Date) {
	const sending = await db.select({ id: emailCampaigns.id }).from(emailCampaigns).where(eq(emailCampaigns.status, "sending"));
	for (const { id } of sending) {
		const rows = await db
			.select({ status: emailDeliveries.status, n: sql<number>`count(*)` })
			.from(emailDeliveries)
			.where(eq(emailDeliveries.campaignId, id))
			.groupBy(emailDeliveries.status);
		const count = (status: string) => Number(rows.find((r) => r.status === status)?.n ?? 0);
		const total = rows.reduce((sum, r) => sum + Number(r.n), 0);
		const counts = { recipientCount: total, sentCount: count("sent"), failedCount: count("failed"), skippedCount: count("skipped_optout") };
		if (count("pending") > 0) {
			await db.update(emailCampaigns).set(counts).where(eq(emailCampaigns.id, id));
			continue;
		}
		const status = counts.failedCount > 0 && counts.sentCount === 0 ? "failed" : "sent";
		await db
			.update(emailCampaigns)
			.set({ ...counts, status, finishedAt: now, updatedAt: now })
			.where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.status, "sending")));
	}
}

export async function runEmailDispatch(db: EmailDb, sender: EmailSender, config: EmailConfig, now = new Date()): Promise<DispatchResult> {
	const claimed = await claimDueCampaigns(db, now);
	const drained = await drain(db, sender, config, now);
	await finish(db, now);
	return { claimed, ...drained };
}
```

Note on the concurrency test. Two ticks can both select the same pending delivery before either marks it sent. If the test shows a duplicate send, add a claim step in `drain`. Before sending each row, run `update email_deliveries set next_attempt_at = now + 10 minutes where id = ? and status = 'pending' and (next_attempt_at is null or next_attempt_at <= now) returning id`, and skip the row if nothing returns. The success and failure updates then overwrite `next_attempt_at`.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run src/server/email/dispatch.integration.test.ts`
Expected: PASS. If "never double-sends" fails, apply the claim step from the note above and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/server/email/sender.ts src/server/email/dispatch.ts src/server/email/dispatch.integration.test.ts
git commit -m "feat(email): add outbox dispatcher with backoff, quota pause, and daily cap"
```

---

### Task 10: Inbound mail, sanitizer, inbox repository

**Files:**
- Modify: `package.json` (add `postal-mime`)
- Create: `src/server/email/sanitize.ts`
- Create: `src/server/email/inbound.ts`
- Create: `src/db/repositories/email-inbox.ts`
- Modify: `src/db/repositories/email.ts` (add `inbox`)
- Test: `src/server/email/sanitize.test.ts`
- Test: `src/server/email/inbound.integration.test.ts`

**Interfaces:**
- Consumes: `plusTag`, `plusAddress`, `EmailConfig` (Task 1); `EmailSender` (Task 9); `assertEmail` (Task 7); `escapeHtml` (Task 4); `memberDisplayName`, `EmailDb` (Task 6).
- Produces:
  - `sanitizeEmailHtml(html: string): Promise<string>`
  - `isAutoReply(headers: Map<string, string>): boolean`
  - `handleInboundEmail(db: EmailDb, bucket: R2Bucket | null, raw: ArrayBuffer, envelope: { from: string; to: string }, now?: Date): Promise<{ threadId: string }>`
  - `MAX_INBOUND_BYTES = 5 * 1024 * 1024`
  - `createEmailInboxRepository(db, audit)` with:
    - `list(actor, opts: { folder: "open" | "done"; filter: "all" | "mine" | "unassigned" }): Promise<ThreadListItem[]>`
    - `get(actor, id): Promise<ThreadView | null>` (marks the thread read)
    - `reply(actor, threadId, body: string, deps: { sender: EmailSender; config: EmailConfig }): Promise<void>`
    - `setStatus(actor, id, status: "open" | "done"): Promise<void>`
    - `assign(actor, id, assigneeId: string | null): Promise<void>`
    - `listAssignees(actor): Promise<{ id: string; name: string }[]>`
    - `openUnreadCount(actor): Promise<number>`
  - `type ThreadListItem = { id; subject; fromEmail; fromName; memberName: string | null; campaignId; campaignSubject: string | null; assigneeId; assigneeName: string | null; status; unread; isAuto; lastMessageAt: Date }`
  - `type ThreadView = { thread: ThreadListItem; messages: InferSelectModel<typeof emailMessages>[] }`

- [ ] **Step 1: Add the dependency**

Run: `pnpm add postal-mime`
Expected: `postal-mime` added to `dependencies`.

- [ ] **Step 2: Write the failing tests**

`src/server/email/sanitize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "./sanitize";

describe("sanitizeEmailHtml", () => {
	it("drops scripts, styles, handlers, forms, and unsafe links", async () => {
		const html = await sanitizeEmailHtml(
			`<html><head><style>p{}</style></head><body><p onclick="x()" style="color:red">Hi <b>there</b></p><script>alert(1)</script><form><input></form><a href="javascript:alert(1)">bad</a><a href="https://ok.com" class="x">ok</a></body></html>`,
		);
		expect(html).not.toMatch(/script|onclick|style|form|input|javascript/i);
		expect(html).toContain("<p>Hi <b>there</b></p>");
		expect(html).toContain('<a href="https://ok.com" target="_blank" rel="noopener noreferrer nofollow">ok</a>');
		expect(html).toContain("<a>bad</a>");
	});

	it("replaces images with their alt text so nothing remote loads", async () => {
		const html = await sanitizeEmailHtml(`<p><img src="https://tracker.example/p.gif" alt="Logo <x>"></p>`);
		expect(html).toBe("<p>[image: Logo &lt;x&gt;]</p>");
	});
});
```

`src/server/email/inbound.integration.test.ts`:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { emailMessages, emailThreads } from "@/db/schema";
import { handleInboundEmail, isAutoReply } from "./inbound";

const db = drizzle(env.DB, { schema });
const encode = (text: string) => new TextEncoder().encode(text.replaceAll("\n", "\r\n")).buffer as ArrayBuffer;

const mail = (opts: { from: string; to: string; subject: string; body: string; extra?: string }) =>
	encode(
		`From: Ana Member <${opts.from}>\nTo: ${opts.to}\nSubject: ${opts.subject}\nMessage-ID: <${crypto.randomUUID()}@gmail.com>\n${opts.extra ?? ""}Content-Type: text/plain; charset=utf-8\n\n${opts.body}\n`,
	);

describe("handleInboundEmail", () => {
	beforeEach(async () => {
		for (const table of ["email_messages", "email_threads", "email_deliveries", "email_campaigns", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES ('mem_a', 'ana@example.com', 'Ana', ?, ?)").bind(Date.now(), Date.now()).run();
		await env.DB.prepare("INSERT INTO email_campaigns (id, subject, preheader, blocks, audience, status, created_at, updated_at) VALUES ('ecmp_1', 'GA', '', '[]', '{\"match\":\"any\",\"include\":[],\"exclude\":[]}', 'sent', ?, ?)")
			.bind(Date.now(), Date.now())
			.run();
		await env.DB.prepare("INSERT INTO email_deliveries (id, campaign_id, member_id, email, status, attempts) VALUES ('edl_1', 'ecmp_1', 'mem_a', 'ana@example.com', 'sent', 1)").run();
	});

	it("threads a plus-addressed reply to its campaign and member", async () => {
		const raw = mail({ from: "ana@example.com", to: "beta-inbox+edl_1@ateneocode.org", subject: "Re: GA", body: "Count me in" });
		const { threadId } = await handleInboundEmail(db, null, raw, { from: "ana@example.com", to: "beta-inbox+edl_1@ateneocode.org" });
		const [thread] = await db.select().from(emailThreads);
		expect(thread).toMatchObject({ id: threadId, campaignId: "ecmp_1", memberId: "mem_a", status: "open", unread: true, isAuto: false });
		const [message] = await db.select().from(emailMessages);
		expect(message.text?.trim()).toBe("Count me in");
	});

	it("appends a second reply from the same person to the same thread", async () => {
		const to = "beta-inbox+edl_1@ateneocode.org";
		const first = await handleInboundEmail(db, null, mail({ from: "ana@example.com", to, subject: "Re: GA", body: "one" }), { from: "ana@example.com", to });
		const second = await handleInboundEmail(db, null, mail({ from: "ana@example.com", to, subject: "Re: GA", body: "two" }), { from: "ana@example.com", to });
		expect(second.threadId).toBe(first.threadId);
		expect(await db.select().from(emailMessages)).toHaveLength(2);
	});

	it("starts a new thread for an untagged mail from a stranger", async () => {
		const to = "beta-inbox@ateneocode.org";
		await handleInboundEmail(db, null, mail({ from: "stranger@else.com", to, subject: "Hello", body: "hi" }), { from: "stranger@else.com", to });
		const [thread] = await db.select().from(emailThreads);
		expect(thread).toMatchObject({ campaignId: null, memberId: null, fromEmail: "stranger@else.com" });
	});

	it("flags auto-replies and keeps them read", async () => {
		const to = "beta-inbox+edl_1@ateneocode.org";
		await handleInboundEmail(
			db,
			null,
			mail({ from: "ana@example.com", to, subject: "Out of office", body: "away", extra: "Auto-Submitted: auto-replied\n" }),
			{ from: "ana@example.com", to },
		);
		const [thread] = await db.select().from(emailThreads);
		expect(thread).toMatchObject({ isAuto: true, unread: false });
	});

	it("keeps an unparseable message", async () => {
		const to = "beta-inbox@ateneocode.org";
		const { threadId } = await handleInboundEmail(db, null, new Uint8Array([0, 1, 2]).buffer as ArrayBuffer, { from: "x@y.com", to });
		expect(threadId).toBeTruthy();
	});
});

describe("isAutoReply", () => {
	it("reads the standard headers", () => {
		expect(isAutoReply(new Map([["auto-submitted", "no"]]))).toBe(false);
		expect(isAutoReply(new Map([["precedence", "bulk"]]))).toBe(true);
		expect(isAutoReply(new Map([["x-autoreply", "yes"]]))).toBe(true);
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm exec vitest run src/server/email/sanitize.test.ts src/server/email/inbound.integration.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `src/server/email/sanitize.ts`**

```ts
const DROP = new Set([
	"script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "button", "textarea", "select",
	"option", "head", "title", "meta", "link", "base", "svg", "math", "noscript", "template", "video", "audio", "source", "picture",
]);
const KEEP = new Set([
	"a", "b", "strong", "i", "em", "u", "s", "p", "br", "div", "span", "ul", "ol", "li", "blockquote", "pre", "code", "h1", "h2", "h3",
	"h4", "h5", "h6", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "hr", "small", "sub", "sup", "center", "font",
]);
const ATTRIBUTES: Record<string, Set<string>> = {
	a: new Set(["href", "title"]),
	td: new Set(["colspan", "rowspan", "align"]),
	th: new Set(["colspan", "rowspan", "align"]),
};

/** Inbound HTML is untrusted. The result is also rendered inside a sandboxed iframe. */
export async function sanitizeEmailHtml(html: string): Promise<string> {
	const rewriter = new HTMLRewriter()
		.on("*", {
			element(element) {
				const tag = element.tagName.toLowerCase();
				if (DROP.has(tag)) {
					element.remove();
					return;
				}
				if (tag === "img") {
					const alt = element.getAttribute("alt")?.trim();
					element.replace(alt ? `[image: ${alt}]` : "[image]", { html: false });
					return;
				}
				if (!KEEP.has(tag)) {
					element.removeAndKeepContent();
					return;
				}
				const allowed = ATTRIBUTES[tag];
				for (const [name] of [...element.attributes]) if (!allowed?.has(name.toLowerCase())) element.removeAttribute(name);
				if (tag === "a") {
					const href = element.getAttribute("href")?.trim() ?? "";
					if (/^(https?:|mailto:)/i.test(href)) {
						element.setAttribute("target", "_blank");
						element.setAttribute("rel", "noopener noreferrer nofollow");
					} else {
						element.removeAttribute("href");
					}
				}
			},
		})
		.onDocument({
			comments(comment) {
				comment.remove();
			},
			doctype() {},
		});
	return (await rewriter.transform(new Response(html)).text()).trim();
}
```

If `element.replace(..., { html: false })` does not escape `<` in this runtime (the test checks for `&lt;x&gt;`), wrap the alt text with `escapeHtml` from `@/lib/email/render` and pass `{ html: true }`.

- [ ] **Step 5: Implement `src/server/email/inbound.ts`**

```ts
import { and, desc, eq, inArray } from "drizzle-orm";
import PostalMime from "postal-mime";
import { emailDeliveries, emailMessages, emailThreads, members } from "@/db/schema";
import type { EmailDb } from "@/db/repositories/email-audience";
import { createId } from "@/lib/ids";
import { plusTag } from "./config";
import { sanitizeEmailHtml } from "./sanitize";

export const MAX_INBOUND_BYTES = 5 * 1024 * 1024;

export function isAutoReply(headers: Map<string, string>): boolean {
	const auto = headers.get("auto-submitted")?.trim().toLowerCase();
	if (auto && auto !== "no") return true;
	if (/^(bulk|auto_reply|junk|list)$/i.test(headers.get("precedence")?.trim() ?? "")) return true;
	return headers.has("x-autoreply") || headers.has("x-autorespond");
}

const ids = (value: string | null | undefined) => (value ? (value.match(/<[^>]+>/g) ?? [value.trim()]) : []);

export async function handleInboundEmail(
	db: EmailDb,
	bucket: R2Bucket | null,
	raw: ArrayBuffer,
	envelope: { from: string; to: string },
	now = new Date(),
): Promise<{ threadId: string }> {
	const id = createId("emsg");
	const rawKey = `email/inbound/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.eml`;
	if (bucket) await bucket.put(rawKey, raw);

	let parsed: Awaited<ReturnType<typeof PostalMime.parse>> | null = null;
	try {
		parsed = await PostalMime.parse(raw);
		if (!parsed.from && !parsed.subject && !parsed.text && !parsed.html) parsed = null;
	} catch {
		parsed = null;
	}

	const headers = new Map((parsed?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
	const auto = isAutoReply(headers);
	const fromEmail = (parsed?.from?.address ?? envelope.from).trim().toLowerCase();
	const fromName = parsed?.from?.name?.trim() || null;
	const subject = parsed ? parsed.subject?.trim() || "(no subject)" : "(could not parse message)";
	const html = parsed?.html ? await sanitizeEmailHtml(parsed.html) : null;
	const text = parsed?.text ?? null;

	const [member] = await db.select({ id: members.id }).from(members).where(eq(members.email, fromEmail)).limit(1);
	const tag = plusTag(envelope.to);
	let threadId: string | null = null;
	let campaignId: string | null = null;

	if (tag?.startsWith("eth_")) {
		const [thread] = await db.select({ id: emailThreads.id }).from(emailThreads).where(eq(emailThreads.id, tag)).limit(1);
		threadId = thread?.id ?? null;
	} else if (tag?.startsWith("edl_")) {
		const [delivery] = await db.select({ campaignId: emailDeliveries.campaignId }).from(emailDeliveries).where(eq(emailDeliveries.id, tag)).limit(1);
		campaignId = delivery?.campaignId ?? null;
		if (campaignId) {
			const [thread] = await db
				.select({ id: emailThreads.id })
				.from(emailThreads)
				.where(and(eq(emailThreads.campaignId, campaignId), eq(emailThreads.fromEmail, fromEmail)))
				.orderBy(desc(emailThreads.lastMessageAt))
				.limit(1);
			threadId = thread?.id ?? null;
		}
	}
	if (!threadId) {
		const refs = [...ids(parsed?.inReplyTo), ...ids(parsed?.references)].slice(0, 20);
		if (refs.length > 0) {
			const [known] = await db.select({ threadId: emailMessages.threadId }).from(emailMessages).where(inArray(emailMessages.messageId, refs)).limit(1);
			threadId = known?.threadId ?? null;
		}
	}

	if (threadId) {
		const [existing] = await db.select({ unread: emailThreads.unread, isAuto: emailThreads.isAuto }).from(emailThreads).where(eq(emailThreads.id, threadId));
		await db
			.update(emailThreads)
			.set({ status: "open", unread: auto ? Boolean(existing?.unread) : true, isAuto: Boolean(existing?.isAuto) && auto, lastMessageAt: now })
			.where(eq(emailThreads.id, threadId));
	} else {
		threadId = createId("eth");
		await db.insert(emailThreads).values({
			id: threadId,
			campaignId,
			memberId: member?.id ?? null,
			fromEmail,
			fromName,
			subject,
			status: "open",
			unread: !auto,
			isAuto: auto,
			lastMessageAt: now,
			createdAt: now,
		});
	}

	await db.insert(emailMessages).values({
		id,
		threadId,
		direction: "in",
		messageId: parsed?.messageId ?? null,
		inReplyTo: parsed?.inReplyTo ?? null,
		referencesHeader: parsed?.references ?? null,
		fromEmail,
		toEmail: envelope.to.toLowerCase(),
		subject,
		text,
		html,
		rawKey: bucket ? rawKey : null,
		createdAt: now,
	});
	return { threadId };
}
```

`R2Bucket` is a global type from `cloudflare-env.d.ts`. If `PostalMime.parse` returns a header list typed differently in the installed version, adjust only the `headers` mapping line.

- [ ] **Step 6: Implement `src/db/repositories/email-inbox.ts`**

```ts
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { emailCampaigns, emailMessages, emailSenders, emailThreads, memberRoles, members, roles } from "@/db/schema";
import { createId } from "@/lib/ids";
import { escapeHtml } from "@/lib/email/render";
import type { Actor } from "@/server/auth/permissions";
import { plusAddress, type EmailConfig } from "@/server/email/config";
import type { EmailSender } from "@/server/email/sender";
import type { AuditRepository } from "./audit";
import { memberDisplayName, type EmailDb } from "./email-audience";
import { assertEmail } from "./email-guard";

export type ThreadListItem = {
	id: string;
	subject: string;
	fromEmail: string;
	fromName: string | null;
	memberName: string | null;
	campaignId: string | null;
	campaignSubject: string | null;
	assigneeId: string | null;
	assigneeName: string | null;
	status: "open" | "done";
	unread: boolean;
	isAuto: boolean;
	lastMessageAt: Date;
};
export type EmailMessageRow = InferSelectModel<typeof emailMessages>;
export type ThreadView = { thread: ThreadListItem; messages: EmailMessageRow[] };

const sender = alias(members, "sender_member");
const assignee = alias(members, "assignee_member");

export function createEmailInboxRepository(db: EmailDb, audit: AuditRepository) {
	const record = (actor: Actor, action: string, targetId: string, detail?: string) =>
		audit.record(actor, { action, targetType: "email_thread", targetId, category: "email", detail: detail ?? null });

	const threadQuery = () =>
		db
			.select({
				thread: emailThreads,
				campaignSubject: emailCampaigns.subject,
				memberName: sender.name,
				memberFullName: sender.fullName,
				memberNickname: sender.nickname,
				memberEmail: sender.email,
				assigneeName: assignee.name,
				assigneeFullName: assignee.fullName,
				assigneeNickname: assignee.nickname,
				assigneeEmail: assignee.email,
			})
			.from(emailThreads)
			.leftJoin(emailCampaigns, eq(emailCampaigns.id, emailThreads.campaignId))
			.leftJoin(sender, eq(sender.id, emailThreads.memberId))
			.leftJoin(assignee, eq(assignee.id, emailThreads.assigneeId));

	type Row = Awaited<ReturnType<ReturnType<typeof threadQuery>["limit"]>>[number];
	const toItem = (r: Row): ThreadListItem => ({
		id: r.thread.id,
		subject: r.thread.subject,
		fromEmail: r.thread.fromEmail,
		fromName: r.thread.fromName,
		memberName: r.memberEmail ? memberDisplayName({ email: r.memberEmail, name: r.memberName, fullName: r.memberFullName, nickname: r.memberNickname }) : null,
		campaignId: r.thread.campaignId,
		campaignSubject: r.campaignSubject,
		assigneeId: r.thread.assigneeId,
		assigneeName: r.assigneeEmail
			? memberDisplayName({ email: r.assigneeEmail, name: r.assigneeName, fullName: r.assigneeFullName, nickname: r.assigneeNickname })
			: null,
		status: r.thread.status,
		unread: r.thread.unread,
		isAuto: r.thread.isAuto,
		lastMessageAt: r.thread.lastMessageAt,
	});

	return {
		async list(actor: Actor, opts: { folder: "open" | "done"; filter: "all" | "mine" | "unassigned" }): Promise<ThreadListItem[]> {
			assertEmail(actor, "email:send");
			const rows = await threadQuery()
				.where(
					and(
						eq(emailThreads.status, opts.folder),
						opts.filter === "mine" ? eq(emailThreads.assigneeId, actor.memberId) : undefined,
						opts.filter === "unassigned" ? isNull(emailThreads.assigneeId) : undefined,
					),
				)
				.orderBy(desc(emailThreads.lastMessageAt))
				.limit(200);
			return rows.map(toItem);
		},

		async get(actor: Actor, id: string): Promise<ThreadView | null> {
			assertEmail(actor, "email:send");
			const [row] = await threadQuery().where(eq(emailThreads.id, id)).limit(1);
			if (!row) return null;
			if (row.thread.unread) await db.update(emailThreads).set({ unread: false }).where(eq(emailThreads.id, id));
			const messages = await db.select().from(emailMessages).where(eq(emailMessages.threadId, id)).orderBy(asc(emailMessages.createdAt));
			return { thread: { ...toItem(row), unread: false }, messages };
		},

		async reply(actor: Actor, threadId: string, body: string, deps: { sender: EmailSender; config: EmailConfig }): Promise<void> {
			assertEmail(actor, "email:send");
			const text = body.trim();
			if (!text) throw new Error("Write a reply first.");
			if (text.length > 20_000) throw new Error("That reply is too long.");
			const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.id, threadId)).limit(1);
			if (!thread) throw new Error("Conversation not found.");
			let [from] = thread.campaignId
				? await db
						.select({ address: emailSenders.address, displayName: emailSenders.displayName })
						.from(emailCampaigns)
						.innerJoin(emailSenders, eq(emailSenders.id, emailCampaigns.senderId))
						.where(eq(emailCampaigns.id, thread.campaignId))
						.limit(1)
				: [];
			if (!from) {
				[from] = await db
					.select({ address: emailSenders.address, displayName: emailSenders.displayName })
					.from(emailSenders)
					.where(isNull(emailSenders.archivedAt))
					.orderBy(asc(emailSenders.displayName))
					.limit(1);
			}
			if (!from) throw new Error("Add a sender in Email settings first.");
			const history = await db
				.select({ messageId: emailMessages.messageId, direction: emailMessages.direction })
				.from(emailMessages)
				.where(eq(emailMessages.threadId, threadId))
				.orderBy(asc(emailMessages.createdAt));
			const chain = history.map((m) => m.messageId).filter((m): m is string => Boolean(m));
			const lastInbound = [...history].reverse().find((m) => m.direction === "in" && m.messageId)?.messageId;
			const headers: Record<string, string> = {};
			if (lastInbound) headers["In-Reply-To"] = lastInbound;
			if (chain.length > 0) headers.References = chain.slice(-20).join(" ");
			const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
			const html = text
				.split(/\n{2,}/)
				.map((p) => `<p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;">${escapeHtml(p).replaceAll("\n", "<br>")}</p>`)
				.join("");
			const result = await deps.sender.send({
				to: thread.fromEmail,
				from: { email: from.address, name: from.displayName },
				replyTo: plusAddress(deps.config.inboxAddress, thread.id),
				subject,
				html,
				text,
				headers,
			});
			const now = new Date();
			await db.insert(emailMessages).values({
				id: createId("emsg"),
				threadId,
				direction: "out",
				messageId: result.messageId,
				inReplyTo: lastInbound ?? null,
				referencesHeader: headers.References ?? null,
				fromEmail: from.address,
				toEmail: thread.fromEmail,
				subject,
				text,
				html,
				sentBy: actor.memberId,
				createdAt: now,
			});
			await db.update(emailThreads).set({ lastMessageAt: now }).where(eq(emailThreads.id, threadId));
			await record(actor, "email:thread_reply", threadId);
		},

		async setStatus(actor: Actor, id: string, status: "open" | "done"): Promise<void> {
			assertEmail(actor, "email:send");
			await db.update(emailThreads).set({ status }).where(eq(emailThreads.id, id));
			await record(actor, status === "done" ? "email:thread_done" : "email:thread_reopen", id);
		},

		async assign(actor: Actor, id: string, assigneeId: string | null): Promise<void> {
			assertEmail(actor, "email:send");
			await db.update(emailThreads).set({ assigneeId }).where(eq(emailThreads.id, id));
			await record(actor, "email:thread_assign", id, assigneeId ?? "unassigned");
		},

		async listAssignees(actor: Actor): Promise<{ id: string; name: string }[]> {
			assertEmail(actor, "email:send");
			const rows = await db
				.selectDistinct({ id: members.id, email: members.email, name: members.name, fullName: members.fullName, nickname: members.nickname })
				.from(members)
				.innerJoin(memberRoles, eq(memberRoles.memberId, members.id))
				.innerJoin(roles, eq(roles.id, memberRoles.roleId))
				.where(inArray(roles.key, ["email", "super"]));
			return rows.map((r) => ({ id: r.id, name: memberDisplayName(r) })).sort((a, b) => a.name.localeCompare(b.name));
		},

		async openUnreadCount(actor: Actor): Promise<number> {
			assertEmail(actor, "email:send");
			const [row] = await db
				.select({ n: sql<number>`count(*)` })
				.from(emailThreads)
				.where(and(eq(emailThreads.status, "open"), eq(emailThreads.unread, true)));
			return Number(row?.n ?? 0);
		},
	};
}
```

Add `inbox: createEmailInboxRepository(db, audit),` to `createEmailRepositories` and `inbox: stub,` to the unavailable object.

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm exec vitest run src/server/email && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/server/email/sanitize.ts src/server/email/sanitize.test.ts src/server/email/inbound.ts src/server/email/inbound.integration.test.ts src/db/repositories/email-inbox.ts src/db/repositories/email.ts
git commit -m "feat(email): store and thread inbound replies, add inbox repository"
```

---

### Task 11: Member archive, preferences, and token opt-out

**Files:**
- Create: `src/db/repositories/email-member.ts`
- Modify: `src/db/repositories/email.ts` (add `member`)
- Test: `src/db/repositories/email-member.integration.test.ts`

**Interfaces:**
- Consumes: `renderEmail`, `valueResolver` (Task 4); `mergeValuesFor` (Task 3); `EmailDb` (Task 6).
- Produces:
  - `type ArchiveItem = { deliveryId: string; subject: string; preheader: string; categoryName: string | null; senderName: string | null; sentAt: Date | null; readAt: Date | null }`
  - `type ReaderView = { deliveryId: string; subject: string; bodyHtml: string; categoryName: string; senderName: string | null; sentAt: Date | null }`
  - `type PreferenceRow = { id: string; name: string; description: string; required: boolean; optedOut: boolean }`
  - `createEmailMemberRepository(db)` with:
    - `listArchive(actor): Promise<ArchiveItem[]>`
    - `unreadCount(actor): Promise<number>`
    - `getForReader(actor, deliveryId: string, baseUrl: string): Promise<ReaderView | null>` (marks read; only the recipient)
    - `listPreferences(actor): Promise<PreferenceRow[]>`
    - `setOptOut(actor, categoryId: string, optedOut: boolean): Promise<void>`
  - `applyTokenOptOut(db: EmailDb, payload: { memberId: string; categoryId: string }, optedOut: boolean): Promise<{ categoryName: string; requiredNames: string[] } | null>` (null means the token does not apply)

- [ ] **Step 1: Write the failing test**

`src/db/repositories/email-member.integration.test.ts`:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { emailOptouts } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { applyTokenOptOut, createEmailMemberRepository } from "./email-member";

const db = drizzle(env.DB, { schema });
const repo = createEmailMemberRepository(db);
const ana: Actor = { memberId: "mem_a", roles: ["member"] };
const ben: Actor = { memberId: "mem_b", roles: ["member"] };

describe("email member side", () => {
	beforeEach(async () => {
		for (const table of ["email_optouts", "email_deliveries", "email_campaigns", "email_categories", "email_senders", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		for (const id of ["mem_a", "mem_b"]) {
			await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, `${id}@x.com`, id, Date.now(), Date.now()).run();
		}
		await env.DB.prepare(
			"INSERT INTO email_categories (id, name, description, required, sort_order, created_at) VALUES ('ecat_req', 'Memos', 'Official memos', 1, 0, ?), ('ecat_opt', 'Newsletter', 'Monthly news', 0, 1, ?), ('ecat_old', 'Old', '', 0, 2, ?)",
		)
			.bind(Date.now(), Date.now(), Date.now())
			.run();
		await env.DB.prepare("UPDATE email_categories SET archived_at = ? WHERE id = 'ecat_old'").bind(Date.now()).run();
		await env.DB.prepare(
			"INSERT INTO email_campaigns (id, category_id, subject, preheader, blocks, audience, status, created_at, updated_at) VALUES ('ecmp_1', 'ecat_opt', 'Hi {{first_name}}', 'News', '[{\"id\":\"t\",\"type\":\"text\",\"props\":{\"text\":\"Hello {{first_name}}\"}}]', '{\"match\":\"any\",\"include\":[],\"exclude\":[]}', 'sent', ?, ?)",
		)
			.bind(Date.now(), Date.now())
			.run();
		await env.DB.prepare(
			"INSERT INTO email_deliveries (id, campaign_id, member_id, email, status, attempts, sent_at) VALUES ('edl_a', 'ecmp_1', 'mem_a', 'mem_a@x.com', 'sent', 1, ?), ('edl_b', 'ecmp_1', 'mem_b', 'mem_b@x.com', 'failed', 3, NULL)",
		)
			.bind(Date.now())
			.run();
	});

	it("lists only sent emails for the member and marks them read", async () => {
		expect((await repo.listArchive(ana)).map((i) => i.deliveryId)).toEqual(["edl_a"]);
		expect(await repo.listArchive(ben)).toEqual([]);
		expect(await repo.unreadCount(ana)).toBe(1);
		const view = await repo.getForReader(ana, "edl_a", "https://beta.ateneocode.org");
		expect(view?.subject).toBe("Hi mem_a");
		expect(view?.bodyHtml).toContain("Hello mem_a");
		expect(await repo.unreadCount(ana)).toBe(0);
	});

	it("refuses to show another member's email", async () => {
		expect(await repo.getForReader(ben, "edl_a", "https://beta.ateneocode.org")).toBeNull();
	});

	it("lists required categories first and blocks opting out of them", async () => {
		const prefs = await repo.listPreferences(ana);
		expect(prefs.map((p) => [p.id, p.required, p.optedOut])).toEqual([
			["ecat_req", true, false],
			["ecat_opt", false, false],
		]);
		await expect(repo.setOptOut(ana, "ecat_req", true)).rejects.toThrow(/required/i);
		await repo.setOptOut(ana, "ecat_opt", true);
		expect((await repo.listPreferences(ana)).find((p) => p.id === "ecat_opt")?.optedOut).toBe(true);
		await repo.setOptOut(ana, "ecat_opt", false);
		expect(await db.select().from(emailOptouts)).toHaveLength(0);
	});

	it("applies a token opt-out only for active optional categories", async () => {
		expect(await applyTokenOptOut(db, { memberId: "mem_a", categoryId: "ecat_opt" }, true)).toEqual({ categoryName: "Newsletter", requiredNames: ["Memos"] });
		expect(await applyTokenOptOut(db, { memberId: "mem_a", categoryId: "ecat_req" }, true)).toBeNull();
		expect(await applyTokenOptOut(db, { memberId: "mem_a", categoryId: "ecat_old" }, true)).toBeNull();
		expect(await applyTokenOptOut(db, { memberId: "mem_gone", categoryId: "ecat_opt" }, true)).toBeNull();
		expect(await db.select().from(emailOptouts)).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/db/repositories/email-member.integration.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/db/repositories/email-member.ts`**

```ts
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { emailCampaigns, emailCategories, emailDeliveries, emailOptouts, emailSenders, members } from "@/db/schema";
import { mergeValuesFor } from "@/lib/email/merge";
import { renderEmail, valueResolver } from "@/lib/email/render";
import type { Actor } from "@/server/auth/permissions";
import type { EmailDb } from "./email-audience";

export type ArchiveItem = {
	deliveryId: string;
	subject: string;
	preheader: string;
	categoryName: string | null;
	senderName: string | null;
	sentAt: Date | null;
	readAt: Date | null;
};
export type ReaderView = { deliveryId: string; subject: string; bodyHtml: string; categoryName: string; senderName: string | null; sentAt: Date | null };
export type PreferenceRow = { id: string; name: string; description: string; required: boolean; optedOut: boolean };

async function activeCategory(db: EmailDb, id: string) {
	const [row] = await db.select().from(emailCategories).where(and(eq(emailCategories.id, id), isNull(emailCategories.archivedAt))).limit(1);
	return row ?? null;
}

async function writeOptOut(db: EmailDb, memberId: string, categoryId: string, optedOut: boolean) {
	if (optedOut) await db.insert(emailOptouts).values({ memberId, categoryId }).onConflictDoNothing();
	else await db.delete(emailOptouts).where(and(eq(emailOptouts.memberId, memberId), eq(emailOptouts.categoryId, categoryId)));
}

/** Token opt-out from an email link. Returns null when the token no longer applies. */
export async function applyTokenOptOut(
	db: EmailDb,
	payload: { memberId: string; categoryId: string },
	optedOut: boolean,
): Promise<{ categoryName: string; requiredNames: string[] } | null> {
	const category = await activeCategory(db, payload.categoryId);
	if (!category || category.required) return null;
	const [member] = await db.select({ id: members.id }).from(members).where(eq(members.id, payload.memberId)).limit(1);
	if (!member) return null;
	await writeOptOut(db, payload.memberId, payload.categoryId, optedOut);
	const required = await db
		.select({ name: emailCategories.name })
		.from(emailCategories)
		.where(and(eq(emailCategories.required, true), isNull(emailCategories.archivedAt)))
		.orderBy(asc(emailCategories.sortOrder));
	return { categoryName: category.name, requiredNames: required.map((r) => r.name) };
}

export function createEmailMemberRepository(db: EmailDb) {
	return {
		async listArchive(actor: Actor): Promise<ArchiveItem[]> {
			const rows = await db
				.select({
					deliveryId: emailDeliveries.id,
					subject: emailCampaigns.subject,
					preheader: emailCampaigns.preheader,
					categoryName: emailCategories.name,
					senderName: emailSenders.displayName,
					sentAt: emailDeliveries.sentAt,
					readAt: emailDeliveries.readAt,
				})
				.from(emailDeliveries)
				.innerJoin(emailCampaigns, eq(emailCampaigns.id, emailDeliveries.campaignId))
				.leftJoin(emailCategories, eq(emailCategories.id, emailCampaigns.categoryId))
				.leftJoin(emailSenders, eq(emailSenders.id, emailCampaigns.senderId))
				.where(and(eq(emailDeliveries.memberId, actor.memberId), eq(emailDeliveries.status, "sent")))
				.orderBy(desc(emailDeliveries.sentAt))
				.limit(200);
			const [member] = await db.select().from(members).where(eq(members.id, actor.memberId)).limit(1);
			const values = mergeValuesFor(member ?? { email: "", name: null, fullName: null, nickname: null, batch: null });
			const merge = (text: string) => text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, tag: string) => (tag in values ? values[tag as keyof typeof values] : whole));
			return rows.map((r) => ({ ...r, subject: merge(r.subject), preheader: merge(r.preheader) }));
		},

		async unreadCount(actor: Actor): Promise<number> {
			const [row] = await db
				.select({ n: sql<number>`count(*)` })
				.from(emailDeliveries)
				.where(and(eq(emailDeliveries.memberId, actor.memberId), eq(emailDeliveries.status, "sent"), isNull(emailDeliveries.readAt)));
			return Number(row?.n ?? 0);
		},

		async getForReader(actor: Actor, deliveryId: string, baseUrl: string): Promise<ReaderView | null> {
			const [row] = await db
				.select({ delivery: emailDeliveries, campaign: emailCampaigns, category: emailCategories, senderName: emailSenders.displayName })
				.from(emailDeliveries)
				.innerJoin(emailCampaigns, eq(emailCampaigns.id, emailDeliveries.campaignId))
				.leftJoin(emailCategories, eq(emailCategories.id, emailCampaigns.categoryId))
				.leftJoin(emailSenders, eq(emailSenders.id, emailCampaigns.senderId))
				.where(and(eq(emailDeliveries.id, deliveryId), eq(emailDeliveries.memberId, actor.memberId), eq(emailDeliveries.status, "sent")))
				.limit(1);
			if (!row) return null;
			if (!row.delivery.readAt) await db.update(emailDeliveries).set({ readAt: new Date() }).where(eq(emailDeliveries.id, deliveryId));
			const [member] = await db.select().from(members).where(eq(members.id, actor.memberId)).limit(1);
			const values = mergeValuesFor(member ?? { email: row.delivery.email, name: null, fullName: null, nickname: null, batch: null });
			const categoryName = row.category?.name ?? "CODE";
			const rendered = renderEmail({
				subject: row.campaign.subject,
				preheader: row.campaign.preheader,
				blocks: row.campaign.blocks,
				resolve: valueResolver(values),
				values,
				baseUrl,
				footer: { categoryName, required: true, archiveUrl: null, preferencesUrl: `${baseUrl}/portal/mail/preferences`, unsubscribeUrl: null },
			});
			return { deliveryId, subject: rendered.subject, bodyHtml: rendered.bodyHtml, categoryName, senderName: row.senderName, sentAt: row.delivery.sentAt };
		},

		async listPreferences(actor: Actor): Promise<PreferenceRow[]> {
			const [categories, optouts] = await Promise.all([
				db.select().from(emailCategories).where(isNull(emailCategories.archivedAt)).orderBy(asc(emailCategories.sortOrder), asc(emailCategories.name)),
				db.select({ categoryId: emailOptouts.categoryId }).from(emailOptouts).where(eq(emailOptouts.memberId, actor.memberId)),
			]);
			const out = new Set(optouts.map((o) => o.categoryId));
			const rows = categories.map((c) => ({ id: c.id, name: c.name, description: c.description, required: c.required, optedOut: !c.required && out.has(c.id) }));
			return [...rows.filter((r) => r.required), ...rows.filter((r) => !r.required)];
		},

		async setOptOut(actor: Actor, categoryId: string, optedOut: boolean): Promise<void> {
			const category = await activeCategory(db, categoryId);
			if (!category) throw new Error("That category no longer exists.");
			if (category.required) throw new Error(`${category.name} is required for members and cannot be turned off.`);
			await writeOptOut(db, actor.memberId, categoryId, optedOut);
		},
	};
}
```

Add `member: createEmailMemberRepository(db),` to `createEmailRepositories` and `member: stub,` to the unavailable object.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/db/repositories/email-member.integration.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/email-member.ts src/db/repositories/email-member.integration.test.ts src/db/repositories/email.ts
git commit -m "feat(email): add member archive, reader, preferences, and token opt-out"
```

---

### Task 12: Custom Worker entry and beta wrangler config

**Files:**
- Create: `custom-worker.ts` (repo root)
- Modify: `wrangler.beta.jsonc` only
- Modify: `cloudflare-env.d.ts` (regenerated)
- Modify: `src/server/cloudflare.ts` (add `EMAIL_*` and `FEATURE_EMAIL` to `CloudflareRuntimeEnv` if typegen does not cover them)

**Interfaces:**
- Consumes: `runEmailDispatch` (Task 9), `bindingSender` (Task 9), `handleInboundEmail`, `MAX_INBOUND_BYTES` (Task 10), `emailConfigFrom` (Task 1).
- Produces: Worker default export with `fetch`, `scheduled`, `email`. `env.EMAIL` binding typed in `cloudflare-env.d.ts`.

- [ ] **Step 1: Create `custom-worker.ts`**

```ts
// OpenNext generates .open-next/worker.js at build time; this entry wraps it to add the
// email cron and the inbound email handler. Only wrangler.beta.jsonc points here.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore generated at build time
import { default as handler } from "./.open-next/worker.js";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./src/db/schema";
import { emailConfigFrom } from "./src/server/email/config";
import { runEmailDispatch } from "./src/server/email/dispatch";
import { handleInboundEmail, MAX_INBOUND_BYTES } from "./src/server/email/inbound";
import { bindingSender } from "./src/server/email/sender";

type Env = CloudflareEnv & { FEATURE_EMAIL?: string };

export default {
	fetch: handler.fetch,

	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		if (env.FEATURE_EMAIL !== "true") return;
		const db = drizzle(env.DB, { schema });
		ctx.waitUntil(
			runEmailDispatch(db, bindingSender(env.EMAIL), emailConfigFrom(env as unknown as Record<string, unknown>)).then(
				(result) => {
					if (result.claimed || result.sent || result.failed || result.paused) console.log("email dispatch", JSON.stringify(result));
				},
				(error) => console.error("email dispatch failed", error),
			),
		);
	},

	async email(message: ForwardableEmailMessage, env: Env) {
		if (env.FEATURE_EMAIL !== "true") {
			message.setReject("This address is not accepting mail.");
			return;
		}
		if (message.rawSize > MAX_INBOUND_BYTES) {
			message.setReject("Message is larger than 5 MB.");
			return;
		}
		const raw = await new Response(message.raw).arrayBuffer();
		await handleInboundEmail(drizzle(env.DB, { schema }), env.BUCKET, raw, { from: message.from, to: message.to });
	},
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 2: Update `wrangler.beta.jsonc`**

- Change `"main": ".open-next/worker.js"` to `"main": "custom-worker.ts"`.
- Add after `"r2_buckets": [...]`:

```jsonc
	"send_email": [
		{
			"name": "EMAIL",
			"allowed_sender_addresses": ["hello@ateneocode.org", "events@ateneocode.org", "officers@ateneocode.org"]
		}
	],
	"triggers": {
		"crons": ["* * * * *"]
	},
```

- Add to `"vars"`:

```jsonc
		"FEATURE_EMAIL": "true",
		"EMAIL_INBOX_ADDRESS": "beta-inbox@ateneocode.org",
		"EMAIL_PUBLIC_BASE_URL": "https://beta.ateneocode.org",
		"EMAIL_BATCH_PER_TICK": "25",
		"EMAIL_DAILY_CAP": "300",
```

`allowed_sender_addresses` must list every sender the admin creates in Settings. Task 20 asks the user which addresses they want before deploy. Leave these three as the starting set.

- [ ] **Step 3: Regenerate types and inspect OpenNext exports**

Run: `pnpm cf-typegen:dev`
Expected: `cloudflare-env.d.ts` now declares `EMAIL: SendEmail` (or similar) and the new vars.

Run: `pnpm build`
Expected: build succeeds and `.open-next/worker.js` exists.

Run: `grep -n "^export" .open-next/worker.js`
Expected: only the default export. If it also exports classes (for example `DOQueueHandler`, `DOShardedTagCache`, `BucketCachePurge`), add a re-export line to `custom-worker.ts` for each one:

```ts
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore generated at build time
export { DOQueueHandler } from "./.open-next/worker.js";
```

- [ ] **Step 4: Dry-run the bundle**

Run: `npx --yes node@22 ./node_modules/wrangler/bin/wrangler.js deploy --dry-run --outdir .wrangler/dry --config wrangler.beta.jsonc`
Expected: bundle succeeds, and the bindings list shows `EMAIL` (send email), `DB`, `BUCKET`, and the cron trigger. If `@/` imports inside `src/` fail to resolve, add `"tsconfig": "tsconfig.json"` to `wrangler.beta.jsonc` and re-run.

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add custom-worker.ts wrangler.beta.jsonc cloudflare-env.d.ts src/server/cloudflare.ts
git commit -m "feat(email): add beta worker entry with email cron and inbound handler"
```

---

### Task 13: UI foundations: toast, motion, pills, progress, preview, nav, server actions

**Files:**
- Create: `src/components/ui/toast.tsx`
- Modify: `src/app/globals.css` (append motion rules)
- Create: `src/components/email/status-pill.tsx`
- Create: `src/components/email/send-progress.tsx`
- Create: `src/components/email/email-preview.tsx`
- Create: `src/server/email/db.ts`
- Modify: `src/app/portal/admin/nav.ts` (add the Email group)
- Modify: `src/components/portal/nav-items.ts` (add Mail to `secondaryNav`)
- Create: `src/app/portal/admin/email/layout.tsx`
- Create: `src/app/portal/admin/email/actions.ts`

**Interfaces:**
- Produces: `ToastProvider`, `useToast(): (toast: { message: string; action?: { label: string; onClick: () => void } }) => void`.
- Produces: `StatusPill({ status })`, `SendProgress({ status, total, sent, failed, skipped, scheduledAt })`, `EmailPreview({ bodyHtml, width })`.
- Produces: `emailDbFromEnv(): EmailDb`, `sendingDepsFromEnv(): { sender: EmailSender; config: EmailConfig }`.
- Produces server actions (all return `ActionResult<T>`):
  - `saveSenderAction(input: { id?: string; address: string; displayName: string }): ActionResult<string>`
  - `setSenderArchivedAction(id: string, archived: boolean): ActionResult<null>`
  - `saveCategoryAction(input: { id?: string; name: string; description: string; required: boolean; defaultSenderId: string | null }): ActionResult<string>`
  - `setCategoryArchivedAction(id: string, archived: boolean): ActionResult<null>`
  - `moveCategoryAction(id: string, direction: "up" | "down"): ActionResult<null>`
  - `saveTemplateAction(input: TemplateInput): ActionResult<string>`
  - `duplicateTemplateAction(id: string): ActionResult<string>`
  - `setTemplateArchivedAction(id: string, archived: boolean): ActionResult<null>`
  - `saveCampaignAction(input: CampaignInput): ActionResult<{ id: string; status: EmailCampaignStatus }>`
  - `previewAudienceAction(audience: Audience, categoryId: string | null): ActionResult<AudiencePreview>`
  - `searchMembersAction(query: string): ActionResult<{ id: string; name: string; email: string; batch: string | null }[]>`
  - `testSendAction(input: { subject: string; preheader: string; blocks: EmailBlock[]; categoryId: string | null; senderId: string | null }): ActionResult<{ to: string }>`
  - `scheduleCampaignAction(id: string, timing: { mode: "now" } | { mode: "at"; local: string }): ActionResult<{ id: string }>`
  - `unscheduleCampaignAction(id: string): ActionResult<null>`
  - `cancelCampaignAction(id: string): ActionResult<null>`
  - `retryFailedAction(id: string): ActionResult<number>`
  - `duplicateCampaignAction(id: string): ActionResult<string>`
  - `replyThreadAction(threadId: string, body: string): ActionResult<null>`
  - `setThreadStatusAction(threadId: string, status: "open" | "done"): ActionResult<null>`
  - `assignThreadAction(threadId: string, assigneeId: string | null): ActionResult<null>`

- [ ] **Step 1: Toast provider**

`src/components/ui/toast.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useState } from "react";

type ToastInput = { message: string; action?: { label: string; onClick: () => void } };
type Toast = ToastInput & { id: number };

const ToastContext = createContext<(toast: ToastInput) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const dismiss = useCallback((id: number) => setToasts((current) => current.filter((t) => t.id !== id)), []);
	const show = useCallback(
		(toast: ToastInput) => {
			const id = Date.now() + Math.random();
			setToasts((current) => [...current.slice(-2), { ...toast, id }]);
			window.setTimeout(() => dismiss(id), toast.action ? 6000 : 4000);
		},
		[dismiss],
	);
	return (
		<ToastContext.Provider value={show}>
			{children}
			<div
				aria-live="polite"
				className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6"
			>
				{toasts.map((toast) => (
					<div
						key={toast.id}
						className="toast-enter pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg"
					>
						<span className="min-w-0 flex-1 break-all sm:break-normal">{toast.message}</span>
						{toast.action ? (
							<button
								type="button"
								className="shrink-0 rounded font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
								onClick={() => {
									toast.action?.onClick();
									dismiss(toast.id);
								}}
							>
								{toast.action.label}
							</button>
						) : null}
					</div>
				))}
			</div>
		</ToastContext.Provider>
	);
}

export const useToast = () => useContext(ToastContext);
```

- [ ] **Step 2: Motion rules**

Append to `src/app/globals.css`:

```css
/* Email surfaces: short, purposeful motion. Every rule has a reduced-motion fallback below. */
@keyframes toast-in {
	from { opacity: 0; transform: translateY(8px) scale(0.98); }
	to { opacity: 1; transform: none; }
}
@keyframes row-in {
	from { opacity: 0; transform: translateY(4px); }
	to { opacity: 1; transform: none; }
}
@keyframes check-pop {
	0% { transform: scale(0.6); opacity: 0; }
	60% { transform: scale(1.12); opacity: 1; }
	100% { transform: scale(1); }
}
.toast-enter { animation: toast-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.row-enter { animation: row-in 200ms ease-out both; }
.check-pop { animation: check-pop 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.row-leave { opacity: 0; transform: translateX(12px); transition: opacity 160ms ease-out, transform 160ms ease-out; }
dialog.email-dialog[open] { animation: toast-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1); }
dialog.email-dialog::backdrop { background: rgb(6 25 47 / 0.45); }

@media (prefers-reduced-motion: reduce) {
	.toast-enter, .row-enter, .check-pop, dialog.email-dialog[open] { animation: none; }
	.row-leave { transition: none; }
}
```

- [ ] **Step 3: Status pill, progress, preview**

`src/components/email/status-pill.tsx`:

```tsx
import type { EmailCampaignStatus, EmailDeliveryStatus } from "@/lib/email/types";
import { cn } from "@/lib/utils";

type Status = EmailCampaignStatus | EmailDeliveryStatus;

const LABELS: Record<Status, string> = {
	draft: "Draft",
	scheduled: "Scheduled",
	sending: "Sending",
	sent: "Sent",
	cancelled: "Cancelled",
	failed: "Failed",
	pending: "Queued",
	skipped_optout: "Opted out",
};

const TONES: Record<Status, string> = {
	draft: "border-border text-muted-foreground",
	scheduled: "border-[#90B4CC] bg-secondary text-secondary-foreground",
	sending: "border-transparent bg-[#4986AC] text-white",
	sent: "border-transparent bg-primary text-primary-foreground",
	cancelled: "border-border text-muted-foreground",
	failed: "border-transparent bg-[#343B41] text-white",
	pending: "border-[#90B4CC] text-secondary-foreground",
	skipped_optout: "border-border text-muted-foreground",
};

export function StatusPill({ status, className }: { status: Status; className?: string }) {
	return (
		<span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", TONES[status], className)}>
			{status === "sending" ? <span className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" aria-hidden /> : null}
			{LABELS[status]}
		</span>
	);
}
```

`src/components/email/send-progress.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { EmailCampaignStatus } from "@/lib/email/types";

const UNDO_WINDOW_MS = 5 * 60_000;

/** Stacked bar plus a live sentence. Refreshes the server page every 3 s while a send is running or about to start. */
export function SendProgress({
	status,
	total,
	sent,
	failed,
	skipped,
	scheduledAt,
}: {
	status: EmailCampaignStatus;
	total: number;
	sent: number;
	failed: number;
	skipped: number;
	scheduledAt: Date | null;
}) {
	const router = useRouter();
	const soon = status === "scheduled" && scheduledAt !== null && scheduledAt.getTime() - Date.now() < UNDO_WINDOW_MS;
	useEffect(() => {
		if (status !== "sending" && !soon) return;
		const timer = window.setInterval(() => router.refresh(), 3000);
		return () => window.clearInterval(timer);
	}, [status, soon, router]);

	const deliverable = Math.max(total - skipped, 0);
	const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : "0%");
	const sentence =
		status === "sending"
			? total === 0
				? "Preparing the recipient list."
				: `Sending ${sent} of ${deliverable}.`
			: status === "scheduled"
				? "Waiting for the scheduled time."
				: status === "draft"
					? "Not sent yet."
					: `${sent} sent${failed ? `, ${failed} failed` : ""}${skipped ? `, ${skipped} opted out` : ""}.`;

	return (
		<div className="grid gap-2">
			<div className="flex h-2 overflow-hidden rounded-full bg-secondary" role="presentation">
				<div className="bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: pct(sent) }} />
				<div className="bg-[#343B41] transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: pct(failed) }} />
				<div className="bg-[#90B4CC] transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: pct(skipped) }} />
			</div>
			<p aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
				{sentence}
			</p>
		</div>
	);
}
```

`src/components/email/email-preview.tsx`:

```tsx
/** Our renderer escapes every value, so its body HTML is safe to inline. Never pass inbound mail here. */
export function EmailPreview({ bodyHtml, width = 600 }: { bodyHtml: string; width?: 600 | 375 }) {
	return (
		<div className="rounded-xl bg-[#F5F5F6] p-3 sm:p-6">
			<div
				className="mx-auto overflow-hidden rounded-xl transition-[max-width] duration-300 ease-out motion-reduce:transition-none"
				style={{ maxWidth: width }}
				dangerouslySetInnerHTML={{ __html: bodyHtml }}
			/>
		</div>
	);
}
```

- [ ] **Step 4: Env helpers**

`src/server/email/db.ts`:

```ts
import { drizzle } from "drizzle-orm/d1";
import type { EmailDb } from "@/db/repositories/email-audience";
import * as schema from "@/db/schema";
import { getCloudflareEnv } from "@/server/cloudflare";
import { emailConfigFrom, type EmailConfig } from "./config";
import { bindingSender, type EmailSender } from "./sender";

export function emailDbFromEnv(): EmailDb {
	return drizzle(getCloudflareEnv().DB, { schema });
}

export function emailConfigFromEnv(): EmailConfig {
	return emailConfigFrom(getCloudflareEnv() as unknown as Record<string, unknown>);
}

export function sendingDepsFromEnv(): { sender: EmailSender; config: EmailConfig } {
	const env = getCloudflareEnv() as unknown as { EMAIL: Parameters<typeof bindingSender>[0] };
	return { sender: bindingSender(env.EMAIL), config: emailConfigFromEnv() };
}
```

- [ ] **Step 5: Navigation**

`src/app/portal/admin/nav.ts`: add this group to `adminGroups` after the `content` group:

```ts
	G("email", "Email", [
		{
			segment: "home",
			label: "Overview",
			description: "Sends in progress, scheduled emails, and recent sends.",
			permission: "email:send",
			feature: "email",
			href: "/portal/admin/email",
		},
		{ segment: "new", label: "New email", description: "Write an email and send it to members.", permission: "email:send", feature: "email" },
		{ segment: "inbox", label: "Replies", description: "Member replies to CODE emails.", permission: "email:send", feature: "email" },
		{ segment: "templates", label: "Templates", description: "Reusable CODE email designs.", permission: "email:configure", feature: "email" },
		{
			segment: "settings",
			label: "Senders & categories",
			description: "From addresses, and which emails members can turn off.",
			permission: "email:configure",
			feature: "email",
		},
	]),
```

`src/components/portal/nav-items.ts`: import `Mail` from `lucide-react` and add to `secondaryNav` after announcements:

```ts
	{ id: "mail", label: "Mail", href: "/portal/mail", icon: Mail, feature: "email" },
```

Run: `pnpm exec vitest run src/app/portal/admin/nav.test.ts`
Expected: PASS. If it asserts exact group lists, add the email group to the expectation.

- [ ] **Step 6: Email admin layout**

`src/app/portal/admin/email/layout.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { ToastProvider } from "@/components/ui/toast";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";

export default async function EmailAdminLayout({ children }: { children: React.ReactNode }) {
	if (!isFeatureEnabled("email")) notFound();
	const actor = await requireActor();
	if (!can(actor, "email:send")) redirect("/portal/admin");
	return <ToastProvider>{children}</ToastProvider>;
}
```

- [ ] **Step 7: Server actions**

`src/app/portal/admin/email/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import type { CampaignInput } from "@/db/repositories/email-campaigns";
import type { TemplateInput } from "@/db/repositories/email-templates";
import { fromLocalInput } from "@/lib/date-slots";
import { runAction } from "@/lib/email/action-result";
import { emailContentSchema } from "@/lib/email/blocks";
import { mergeValuesFor } from "@/lib/email/merge";
import { renderEmail, valueResolver } from "@/lib/email/render";
import type { Audience, EmailBlock } from "@/lib/email/types";
import { requireActor } from "@/server/auth/actor";
import { sendingDepsFromEnv } from "@/server/email/db";
import { assertFeatureEnabled } from "@/server/features";

const BASE = "/portal/admin/email";
const idSchema = z.string().min(1).max(64);

async function context() {
	assertFeatureEnabled("email");
	const actor = await requireActor();
	const repos = await getRepositories();
	return { actor, repos, email: repos.email };
}

const done = () => null;

export async function saveSenderAction(input: { id?: string; address: string; displayName: string }) {
	return runAction(async () => {
		const { actor, email } = await context();
		const row = await email.settings.saveSender(actor, z.object({ id: idSchema.optional(), address: z.string().max(200), displayName: z.string().max(80) }).parse(input));
		revalidatePath(`${BASE}/settings`);
		return row.id;
	});
}

export async function setSenderArchivedAction(id: string, archived: boolean) {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.settings.setSenderArchived(actor, idSchema.parse(id), archived);
		revalidatePath(`${BASE}/settings`);
		return done();
	});
}

export async function saveCategoryAction(input: { id?: string; name: string; description: string; required: boolean; defaultSenderId: string | null }) {
	return runAction(async () => {
		const { actor, email } = await context();
		const parsed = z
			.object({
				id: idSchema.optional(),
				name: z.string().max(60),
				description: z.string().max(200),
				required: z.boolean(),
				defaultSenderId: idSchema.nullable(),
			})
			.parse(input);
		const row = await email.settings.saveCategory(actor, parsed);
		revalidatePath(`${BASE}/settings`);
		return row.id;
	});
}

export async function setCategoryArchivedAction(id: string, archived: boolean) {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.settings.setCategoryArchived(actor, idSchema.parse(id), archived);
		revalidatePath(`${BASE}/settings`);
		return done();
	});
}

export async function moveCategoryAction(id: string, direction: "up" | "down") {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.settings.moveCategory(actor, idSchema.parse(id), z.enum(["up", "down"]).parse(direction));
		revalidatePath(`${BASE}/settings`);
		return done();
	});
}

export async function saveTemplateAction(input: TemplateInput) {
	return runAction(async () => {
		const { actor, email } = await context();
		const row = await email.templates.save(actor, input);
		revalidatePath(`${BASE}/templates`);
		return row.id;
	});
}

export async function duplicateTemplateAction(id: string) {
	return runAction(async () => {
		const { actor, email } = await context();
		const row = await email.templates.duplicate(actor, idSchema.parse(id));
		revalidatePath(`${BASE}/templates`);
		return row.id;
	});
}

export async function setTemplateArchivedAction(id: string, archived: boolean) {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.templates.setArchived(actor, idSchema.parse(id), archived);
		revalidatePath(`${BASE}/templates`);
		return done();
	});
}

export async function saveCampaignAction(input: CampaignInput) {
	return runAction(async () => {
		const { actor, email } = await context();
		const row = await email.campaigns.saveDraft(actor, input);
		revalidatePath(BASE);
		return { id: row.id, status: row.status };
	});
}

export async function previewAudienceAction(audience: Audience, categoryId: string | null) {
	return runAction(async () => {
		const { actor, email } = await context();
		return email.campaigns.previewAudience(actor, audience, categoryId ? idSchema.parse(categoryId) : null);
	});
}

export async function searchMembersAction(query: string) {
	return runAction(async () => {
		const { actor, email } = await context();
		return email.campaigns.searchMembers(actor, z.string().max(80).parse(query));
	});
}

export async function testSendAction(input: { subject: string; preheader: string; blocks: EmailBlock[]; categoryId: string | null; senderId: string | null }) {
	return runAction(async () => {
		const { actor, repos, email } = await context();
		const content = emailContentSchema.parse({ subject: input.subject, preheader: input.preheader, blocks: input.blocks });
		const [senders, categories, me] = await Promise.all([
			email.settings.listSenders(actor),
			email.settings.listCategories(actor),
			repos.members.getById(actor, actor.memberId),
		]);
		const from = senders.find((s) => s.id === input.senderId) ?? senders[0];
		if (!from) throw new Error("Add a sender in Email settings first.");
		if (!me) throw new Error("Your member profile was not found.");
		const category = categories.find((c) => c.id === input.categoryId);
		const { sender, config } = sendingDepsFromEnv();
		const values = mergeValuesFor(me);
		const rendered = renderEmail({
			...content,
			resolve: valueResolver(values),
			values,
			baseUrl: config.publicBaseUrl,
			footer: {
				categoryName: category?.name ?? "Test",
				required: category?.required ?? true,
				archiveUrl: null,
				preferencesUrl: `${config.publicBaseUrl}/portal/mail/preferences`,
				unsubscribeUrl: category && !category.required ? `${config.publicBaseUrl}/unsubscribe` : null,
			},
		});
		await sender.send({
			to: me.email,
			from: { email: from.address, name: from.displayName },
			replyTo: config.inboxAddress,
			subject: `[Test] ${rendered.subject}`,
			html: rendered.html,
			text: rendered.text,
		});
		await repos.audit.record(actor, { action: "email:test_send", targetType: "member", targetId: actor.memberId, category: "email" });
		return { to: me.email };
	});
}

export async function scheduleCampaignAction(id: string, timing: { mode: "now" } | { mode: "at"; local: string }) {
	return runAction(async () => {
		const { actor, email } = await context();
		const parsed = z
			.discriminatedUnion("mode", [z.object({ mode: z.literal("now") }), z.object({ mode: z.literal("at"), local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) })])
			.parse(timing);
		// "Send now" waits two minutes so the report page can offer Undo.
		const at = parsed.mode === "now" ? new Date(Date.now() + 2 * 60_000) : fromLocalInput(parsed.local);
		const row = await email.campaigns.schedule(actor, idSchema.parse(id), at);
		revalidatePath(BASE);
		return { id: row.id };
	});
}

export async function unscheduleCampaignAction(id: string) {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.campaigns.unschedule(actor, idSchema.parse(id));
		revalidatePath(BASE);
		return done();
	});
}

export async function cancelCampaignAction(id: string) {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.campaigns.cancel(actor, idSchema.parse(id));
		revalidatePath(BASE);
		return done();
	});
}

export async function retryFailedAction(id: string) {
	return runAction(async () => {
		const { actor, email } = await context();
		const count = await email.campaigns.retryFailed(actor, idSchema.parse(id));
		revalidatePath(BASE);
		return count;
	});
}

export async function duplicateCampaignAction(id: string) {
	return runAction(async () => {
		const { actor, email } = await context();
		const row = await email.campaigns.duplicate(actor, idSchema.parse(id));
		revalidatePath(BASE);
		return row.id;
	});
}

export async function replyThreadAction(threadId: string, body: string) {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.inbox.reply(actor, idSchema.parse(threadId), z.string().max(20_000).parse(body), sendingDepsFromEnv());
		revalidatePath(`${BASE}/inbox`);
		return done();
	});
}

export async function setThreadStatusAction(threadId: string, status: "open" | "done") {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.inbox.setStatus(actor, idSchema.parse(threadId), z.enum(["open", "done"]).parse(status));
		revalidatePath(`${BASE}/inbox`);
		return done();
	});
}

export async function assignThreadAction(threadId: string, assigneeId: string | null) {
	return runAction(async () => {
		const { actor, email } = await context();
		await email.inbox.assign(actor, idSchema.parse(threadId), assigneeId ? idSchema.parse(assigneeId) : null);
		revalidatePath(`${BASE}/inbox`);
		return done();
	});
}
```

- [ ] **Step 8: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test:workers`
Expected: PASS.

```bash
git add src/components/ui/toast.tsx src/app/globals.css src/components/email src/server/email/db.ts src/app/portal/admin/nav.ts src/components/portal/nav-items.ts src/app/portal/admin/email/layout.tsx src/app/portal/admin/email/actions.ts
git commit -m "feat(email): add email UI foundations, navigation, and server actions"
```

---

### Task 14: Email home and settings screens

**Files:**
- Create: `src/app/portal/admin/email/page.tsx`
- Create: `src/app/portal/admin/email/campaign-row.tsx`
- Create: `src/app/portal/admin/email/settings/page.tsx`
- Create: `src/app/portal/admin/email/settings/settings-panels.tsx`

**Interfaces:**
- Consumes: `email.campaigns.home`, `email.templates.list`, `email.inbox.openUnreadCount`, `email.settings.*` (Tasks 7-10); `StatusPill`, `SendProgress` (Task 13); settings actions (Task 13); `Sheet` primitives from `src/components/ui/sheet.tsx`.
- Produces: `CampaignRow({ campaign, meta })` shared by home and report back-links. `formatManila(date: Date): string` exported from `campaign-row.tsx`.

- [ ] **Step 1: Campaign row**

`src/app/portal/admin/email/campaign-row.tsx`:

```tsx
import Link from "next/link";
import { StatusPill } from "@/components/email/status-pill";
import type { CampaignListItem } from "@/db/repositories/email-campaigns";

const MANILA = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const formatManila = (date: Date) => MANILA.format(date);

export function CampaignRow({ campaign, meta, index = 0 }: { campaign: CampaignListItem; meta: string; index?: number }) {
	const href = campaign.status === "draft" ? `/portal/admin/email/sends/${campaign.id}/edit` : `/portal/admin/email/sends/${campaign.id}`;
	return (
		<li className="row-enter" style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}>
			<Link
				href={href}
				className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-secondary/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
			>
				<div className="grid min-w-0 flex-1 gap-0.5">
					<span className="min-w-0 truncate font-medium">{campaign.subject.trim() || "Untitled email"}</span>
					<span className="min-w-0 truncate text-sm text-muted-foreground">{meta}</span>
				</div>
				<StatusPill status={campaign.status} />
			</Link>
		</li>
	);
}
```

- [ ] **Step 2: Home page**

`src/app/portal/admin/email/page.tsx`:

```tsx
import Link from "next/link";
import { Inbox, LayoutTemplate, PenLine } from "lucide-react";
import { getRepositories } from "@/db";
import { SendProgress } from "@/components/email/send-progress";
import { Button } from "@/components/ui/button";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { emailConfigFromEnv } from "@/server/email/db";
import { CampaignRow, formatManila } from "./campaign-row";

export const dynamic = "force-dynamic";
const MONTHLY_INCLUDED = 3000;

function Section({ title, empty, children, count }: { title: string; empty: string; children: React.ReactNode; count: number }) {
	return (
		<section className="grid gap-2">
			<h2 className="px-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
			{count === 0 ? <p className="px-3 text-sm text-muted-foreground">{empty}</p> : <ul className="grid">{children}</ul>}
		</section>
	);
}

export default async function EmailHomePage() {
	const actor = await requireActor();
	const { email } = await getRepositories();
	const [summary, unread, templates] = await Promise.all([
		email.campaigns.home(actor),
		email.inbox.openUnreadCount(actor),
		can(actor, "email:configure") ? email.templates.list(actor) : Promise.resolve([]),
	]);
	const config = emailConfigFromEnv();
	const monthPct = Math.min((summary.sentThisMonth / MONTHLY_INCLUDED) * 100, 100);
	const now = new Date();
	const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

	return (
		<div className="grid gap-6">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					<h1 className="font-heading text-3xl">Email</h1>
					<p className="text-sm text-muted-foreground">Send CODE emails to members and read their replies.</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button asChild variant="outline">
						<Link href="/portal/admin/email/inbox">
							<Inbox />
							Replies{unread > 0 ? <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">{unread}</span> : null}
						</Link>
					</Button>
					<Button asChild>
						<Link href="/portal/admin/email/new">
							<PenLine />
							New email
						</Link>
					</Button>
				</div>
			</header>

			<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
				<div className="grid content-start gap-6">
					{summary.sending.length > 0 ? (
						<section className="grid gap-3 rounded-xl border border-[#4986AC] bg-card p-4">
							<h2 className="text-sm font-semibold">Sending now</h2>
							{summary.sending.map((c) => (
								<Link key={c.id} href={`/portal/admin/email/sends/${c.id}`} className="grid gap-2 rounded-lg p-2 transition-colors hover:bg-secondary/60">
									<span className="min-w-0 truncate font-medium">{c.subject}</span>
									<SendProgress status={c.status} total={c.recipientCount} sent={c.sentCount} failed={c.failedCount} skipped={c.skippedCount} scheduledAt={c.scheduledAt} />
								</Link>
							))}
						</section>
					) : null}
					<Section title="Scheduled" empty="Nothing scheduled." count={summary.scheduled.length}>
						{summary.scheduled.map((c, i) => (
							<CampaignRow key={c.id} index={i} campaign={c} meta={`${c.scheduledAt ? formatManila(c.scheduledAt) : ""} · ${c.categoryName ?? "No category"}`} />
						))}
					</Section>
					<Section title="Recent sends" empty="No emails sent yet." count={summary.recent.length}>
						{summary.recent.map((c, i) => (
							<CampaignRow
								key={c.id}
								index={i}
								campaign={c}
								meta={`${c.finishedAt ? formatManila(c.finishedAt) : ""} · ${c.sentCount} sent${c.failedCount ? ` · ${c.failedCount} failed` : ""}`}
							/>
						))}
					</Section>
					<Section title="Drafts" empty="No drafts." count={summary.drafts.length}>
						{summary.drafts.map((c, i) => (
							<CampaignRow key={c.id} index={i} campaign={c} meta={`Edited ${formatManila(c.updatedAt)}`} />
						))}
					</Section>
				</div>

				<aside className="grid content-start gap-4">
					<div className="grid gap-2 rounded-xl border border-border bg-card p-4">
						<p className="text-sm">
							<span className="font-semibold tabular-nums">{summary.sentThisMonth.toLocaleString()}</span> of {MONTHLY_INCLUDED.toLocaleString()} included emails
							this month
						</p>
						<div className="h-1.5 overflow-hidden rounded-full bg-secondary">
							<div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${monthPct}%` }} />
						</div>
						<p className="text-xs text-muted-foreground">
							Resets {formatManila(nextMonth).split(",")[0]}. Today: {summary.sentToday} of {config.dailyCap} allowed.
						</p>
					</div>
					{templates.length > 0 ? (
						<div className="grid gap-2 rounded-xl border border-border bg-card p-4">
							<div className="flex items-center justify-between">
								<h2 className="text-sm font-semibold">Start from a template</h2>
								<Link href="/portal/admin/email/templates" className="text-sm text-accent underline-offset-2 hover:underline">
									All
								</Link>
							</div>
							<ul className="grid gap-1">
								{templates.slice(0, 4).map((t) => (
									<li key={t.id}>
										<Link
											href={`/portal/admin/email/new?template=${t.id}`}
											className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-secondary/60"
										>
											<LayoutTemplate className="size-4 shrink-0 text-muted-foreground" aria-hidden />
											<span className="min-w-0 truncate">{t.name}</span>
										</Link>
									</li>
								))}
							</ul>
						</div>
					) : null}
				</aside>
			</div>
		</div>
	);
}
```

If `Button` in `src/components/ui/button.tsx` does not support `asChild`, use `<Link className={buttonVariants({ variant: "outline" })}>` instead (`buttonVariants` is exported there).

- [ ] **Step 3: Settings page**

`src/app/portal/admin/email/settings/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { AdminIntro } from "@/components/portal/admin-intro";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { SettingsPanels } from "./settings-panels";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
	const actor = await requireActor();
	if (!can(actor, "email:configure")) redirect("/portal/admin/email");
	const { email } = await getRepositories();
	const [senders, categories] = await Promise.all([
		email.settings.listSenders(actor, { includeArchived: true }),
		email.settings.listCategories(actor, { includeArchived: true }),
	]);
	return (
		<div className="grid gap-6">
			<AdminIntro
				title="Senders & categories"
				whoFor="Senders are the From addresses an email can use"
				effect="Categories group emails; members can turn off optional categories, never required ones"
			/>
			<SettingsPanels senders={senders} categories={categories} />
		</div>
	);
}
```

`src/app/portal/admin/email/settings/settings-panels.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Lock, Plus } from "lucide-react";
import type { EmailCategoryRow, EmailSenderRow } from "@/db/repositories/email-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
	moveCategoryAction,
	saveCategoryAction,
	saveSenderAction,
	setCategoryArchivedAction,
	setSenderArchivedAction,
} from "../actions";

type Editing =
	| { kind: "sender"; row: Partial<EmailSenderRow> }
	| { kind: "category"; row: Partial<EmailCategoryRow> }
	| null;

export function SettingsPanels({ senders, categories }: { senders: EmailSenderRow[]; categories: EmailCategoryRow[] }) {
	const router = useRouter();
	const toast = useToast();
	const [editing, setEditing] = useState<Editing>(null);
	const [showArchived, setShowArchived] = useState(false);
	const [pending, startTransition] = useTransition();
	const activeSenders = senders.filter((s) => !s.archivedAt);
	const visibleSenders = showArchived ? senders : activeSenders;
	const visibleCategories = showArchived ? categories : categories.filter((c) => !c.archivedAt);

	const run = (task: () => Promise<{ ok: boolean; error?: string }>, success: string, undo?: () => void) =>
		startTransition(async () => {
			const result = await task();
			if (!result.ok) {
				toast({ message: result.error ?? "Something went wrong." });
				return;
			}
			toast({ message: success, action: undo ? { label: "Undo", onClick: undo } : undefined });
			setEditing(null);
			router.refresh();
		});

	return (
		<div className="grid gap-6">
			<label className="flex items-center gap-2 justify-self-end text-sm text-muted-foreground">
				<input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="size-4 accent-[#06192F]" />
				Show archived
			</label>

			<section className="grid gap-3 rounded-xl border border-border bg-card p-4">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<h2 className="font-heading text-xl">Senders</h2>
						<p className="text-sm text-muted-foreground">Each address must also be on the Worker&apos;s allowed sender list.</p>
					</div>
					<Button variant="outline" onClick={() => setEditing({ kind: "sender", row: {} })}>
						<Plus />
						Add sender
					</Button>
				</div>
				<ul className="grid divide-y divide-border">
					{visibleSenders.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No senders yet. Add one to start sending.</li> : null}
					{visibleSenders.map((s) => (
						<li key={s.id} className={cn("row-enter flex min-w-0 items-center gap-3 py-3", s.archivedAt && "opacity-60")}>
							<div className="grid min-w-0 flex-1">
								<span className="min-w-0 break-all font-medium">{s.displayName}</span>
								<span className="min-w-0 break-all text-sm text-muted-foreground">{s.address}</span>
							</div>
							<Button variant="ghost" size="sm" onClick={() => setEditing({ kind: "sender", row: s })}>
								Edit
							</Button>
							<Button
								variant="ghost"
								size="sm"
								disabled={pending}
								onClick={() =>
									run(
										() => setSenderArchivedAction(s.id, !s.archivedAt),
										s.archivedAt ? "Sender restored." : "Sender archived.",
										s.archivedAt ? undefined : () => run(() => setSenderArchivedAction(s.id, false), "Sender restored."),
									)
								}
							>
								{s.archivedAt ? "Restore" : "Archive"}
							</Button>
						</li>
					))}
				</ul>
			</section>

			<section className="grid gap-3 rounded-xl border border-border bg-card p-4">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<h2 className="font-heading text-xl">Categories</h2>
						<p className="text-sm text-muted-foreground">Members see these, in this order, on their email preferences page.</p>
					</div>
					<Button variant="outline" onClick={() => setEditing({ kind: "category", row: { required: false } })}>
						<Plus />
						Add category
					</Button>
				</div>
				<ul className="grid divide-y divide-border">
					{visibleCategories.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No categories yet. Every email needs one.</li> : null}
					{visibleCategories.map((c, index) => (
						<li key={c.id} className={cn("row-enter flex min-w-0 flex-wrap items-center gap-3 py-3", c.archivedAt && "opacity-60")}>
							<div className="grid min-w-0 flex-1 gap-0.5">
								<span className="flex min-w-0 items-center gap-2 font-medium">
									<span className="min-w-0 break-all">{c.name}</span>
									{c.required ? (
										<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
											<Lock className="size-3" aria-hidden />
											Required
										</span>
									) : (
										<span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">Optional</span>
									)}
								</span>
								{c.description ? <span className="min-w-0 break-all text-sm text-muted-foreground">{c.description}</span> : null}
							</div>
							<div className="flex items-center gap-1">
								<Button variant="ghost" size="icon" aria-label={`Move ${c.name} up`} disabled={pending || index === 0} onClick={() => run(() => moveCategoryAction(c.id, "up"), "Order saved.")}>
									<ArrowUp />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									aria-label={`Move ${c.name} down`}
									disabled={pending || index === visibleCategories.length - 1}
									onClick={() => run(() => moveCategoryAction(c.id, "down"), "Order saved.")}
								>
									<ArrowDown />
								</Button>
								<Button variant="ghost" size="sm" onClick={() => setEditing({ kind: "category", row: c })}>
									Edit
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={pending}
									onClick={() =>
										run(
											() => setCategoryArchivedAction(c.id, !c.archivedAt),
											c.archivedAt ? "Category restored." : "Category archived.",
											c.archivedAt ? undefined : () => run(() => setCategoryArchivedAction(c.id, false), "Category restored."),
										)
									}
								>
									{c.archivedAt ? "Restore" : "Archive"}
								</Button>
							</div>
						</li>
					))}
				</ul>
				<a href="/portal/mail/preferences" className="justify-self-start text-sm text-accent underline-offset-2 hover:underline">
					Preview the member preferences page
				</a>
			</section>

			<Sheet open={editing !== null} onOpenChange={(open) => (open ? null : setEditing(null))}>
				<SheetContent>
					{editing?.kind === "sender" ? (
						<form
							className="grid gap-4 p-4"
							onSubmit={(e) => {
								e.preventDefault();
								const data = new FormData(e.currentTarget);
								run(
									() =>
										saveSenderAction({
											id: editing.row.id,
											address: String(data.get("address") ?? ""),
											displayName: String(data.get("displayName") ?? ""),
										}),
									"Sender saved.",
								);
							}}
						>
							<SheetHeader className="p-0">
								<SheetTitle>{editing.row.id ? "Edit sender" : "Add sender"}</SheetTitle>
								<SheetDescription>Members see the display name in their inbox.</SheetDescription>
							</SheetHeader>
							<label className="grid gap-2 text-sm font-medium">
								Display name
								<Input name="displayName" defaultValue={editing.row.displayName ?? ""} placeholder="CODE Events" maxLength={80} required />
							</label>
							<label className="grid gap-2 text-sm font-medium">
								Address
								<Input name="address" type="email" defaultValue={editing.row.address ?? ""} placeholder="events@ateneocode.org" required />
							</label>
							<Button type="submit" disabled={pending}>
								Save sender
							</Button>
						</form>
					) : null}
					{editing?.kind === "category" ? (
						<form
							className="grid gap-4 p-4"
							onSubmit={(e) => {
								e.preventDefault();
								const data = new FormData(e.currentTarget);
								run(
									() =>
										saveCategoryAction({
											id: editing.row.id,
											name: String(data.get("name") ?? ""),
											description: String(data.get("description") ?? ""),
											required: data.get("required") === "required",
											defaultSenderId: String(data.get("defaultSenderId") ?? "") || null,
										}),
									"Category saved.",
								);
							}}
						>
							<SheetHeader className="p-0">
								<SheetTitle>{editing.row.id ? "Edit category" : "Add category"}</SheetTitle>
								<SheetDescription>Required categories reach every member. Optional ones can be turned off.</SheetDescription>
							</SheetHeader>
							<label className="grid gap-2 text-sm font-medium">
								Name
								<Input name="name" defaultValue={editing.row.name ?? ""} placeholder="Newsletter" maxLength={60} required />
							</label>
							<label className="grid gap-2 text-sm font-medium">
								What members get
								<Textarea name="description" defaultValue={editing.row.description ?? ""} rows={3} maxLength={200} placeholder="Monthly news and opportunities." />
							</label>
							<fieldset className="grid gap-2">
								<legend className="text-sm font-medium">Can members turn it off?</legend>
								{[
									{ value: "optional", label: "Optional", hint: "Members can turn it off." },
									{ value: "required", label: "Required", hint: "Announcements and memos. Always delivered." },
								].map((option) => (
									<label
										key={option.value}
										className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary/50"
									>
										<input
											type="radio"
											name="required"
											value={option.value}
											defaultChecked={(editing.row.required ? "required" : "optional") === option.value}
											className="mt-1 accent-[#06192F]"
										/>
										<span className="grid">
											<span className="font-medium">{option.label}</span>
											<span className="text-sm text-muted-foreground">{option.hint}</span>
										</span>
									</label>
								))}
							</fieldset>
							<label className="grid gap-2 text-sm font-medium">
								Default sender
								<select
									name="defaultSenderId"
									defaultValue={editing.row.defaultSenderId ?? ""}
									className="h-9 rounded-md border border-input bg-background px-3 text-sm"
								>
									<option value="">None</option>
									{activeSenders.map((s) => (
										<option key={s.id} value={s.id}>
											{s.displayName} ({s.address})
										</option>
									))}
								</select>
							</label>
							<Button type="submit" disabled={pending}>
								Save category
							</Button>
						</form>
					) : null}
				</SheetContent>
			</Sheet>
		</div>
	);
}
```

Check the `Button` `size` variants in `src/components/ui/button.tsx`. If `"icon"` or `"sm"` do not exist, use the nearest existing size.

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add src/app/portal/admin/email/page.tsx src/app/portal/admin/email/campaign-row.tsx src/app/portal/admin/email/settings
git commit -m "feat(email): add email overview and sender/category settings screens"
```

---

### Task 15: Block editor and templates

**Files:**
- Create: `src/components/email/tagged-field.tsx`
- Create: `src/components/email/block-editor.tsx`
- Create: `src/app/portal/admin/email/templates/page.tsx`
- Create: `src/app/portal/admin/email/templates/[id]/page.tsx`
- Create: `src/app/portal/admin/email/templates/[id]/template-editor.tsx`
- Create: `src/app/portal/admin/email/use-autosave.ts`

**Interfaces:**
- Consumes: `newBlock`, `newEventBlock` (Task 3); `MERGE_TAGS`, `MERGE_TAG_LABELS`, `SAMPLE_MERGE_VALUES`, `mergeValuesFor` (Task 3); `renderBlockHtml`, `renderHeaderHtml`, `renderFooterHtml`, `renderEmail`, `pillResolver`, `valueResolver` (Task 4); `formatEventWhen` (Task 8); template actions (Task 13).
- Produces:
  - `TaggedField({ label, value, onChange, multiline?, rows?, maxLength?, hint?, placeholder? })`
  - `type EventOption = { id: string; title: string; when: string; place: string }`
  - `type PreviewPerson = { label: string; values: MergeValues }`
  - `BlockEditor({ blocks, onChange, baseUrl, footer, people, events, layout })` where `layout: "wide" | "compact"`
  - `useAutosave<T>(value: T, save: (value: T) => Promise<boolean>, delay?: number): { state: "idle" | "saving" | "saved" | "error"; flush: () => Promise<boolean> }`

- [ ] **Step 1: Autosave hook**

`src/app/portal/admin/email/use-autosave.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SaveState = "idle" | "saving" | "saved" | "error";

/** Saves `value` 1.2 s after the last change. Skips the first render so opening a page never writes. */
export function useAutosave<T>(value: T, save: (value: T) => Promise<boolean>, delay = 1200) {
	const [state, setState] = useState<SaveState>("idle");
	const first = useRef(true);
	const latest = useRef(value);
	const saveRef = useRef(save);
	const dirty = useRef(false);
	latest.current = value;
	saveRef.current = save;

	const flush = useCallback(async () => {
		if (!dirty.current) return true;
		dirty.current = false;
		setState("saving");
		const ok = await saveRef.current(latest.current);
		setState(ok ? "saved" : "error");
		if (!ok) dirty.current = true;
		return ok;
	}, []);

	useEffect(() => {
		if (first.current) {
			first.current = false;
			return;
		}
		dirty.current = true;
		const timer = window.setTimeout(() => void flush(), delay);
		return () => window.clearTimeout(timer);
	}, [value, delay, flush]);

	return { state, flush };
}
```

Callers pass a memoized `value` object (via `useMemo`) so the effect runs only on real edits.

- [ ] **Step 2: Tagged field with merge tag menu**

`src/components/email/tagged-field.tsx`:

```tsx
"use client";

import { useId, useRef, useState } from "react";
import { Braces } from "lucide-react";
import { MERGE_TAGS, MERGE_TAG_LABELS, type MergeTag } from "@/lib/email/merge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Props = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	multiline?: boolean;
	rows?: number;
	maxLength?: number;
	hint?: string;
	placeholder?: string;
};

/** Text input that inserts {{tags}}. Type "{" or use the Insert field button. */
export function TaggedField({ label, value, onChange, multiline, rows = 5, maxLength, hint, placeholder }: Props) {
	const id = useId();
	const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
	const caret = useRef<{ start: number; end: number }>({ start: value.length, end: value.length });
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);

	const remember = () => {
		const el = ref.current;
		caret.current = { start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
	};
	const insert = (text: string) => {
		const { start, end } = caret.current;
		onChange(value.slice(0, start) + text + value.slice(end));
		setOpen(false);
		requestAnimationFrame(() => {
			ref.current?.focus();
			ref.current?.setSelectionRange(start + text.length, start + text.length);
		});
	};
	const pick = (tag: MergeTag) => insert(`{{${tag}}}`);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (open) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + MERGE_TAGS.length) % MERGE_TAGS.length);
			} else if (e.key === "Enter") {
				e.preventDefault();
				pick(MERGE_TAGS[active]);
			} else if (e.key === "Escape") {
				e.preventDefault();
				insert("{");
			}
			return;
		}
		if (e.key === "{") {
			e.preventDefault();
			remember();
			setActive(0);
			setOpen(true);
		}
	};

	const field = multiline ? (
		<Textarea id={id} ref={ref} rows={rows} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onSelect={remember} />
	) : (
		<Input id={id} ref={ref} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onSelect={remember} />
	);

	return (
		<div className="relative grid gap-2">
			<div className="flex items-center justify-between gap-2">
				<label htmlFor={id} className="text-sm font-medium">
					{label}
				</label>
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-accent transition-colors hover:bg-secondary"
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => {
						remember();
						setActive(0);
						setOpen((o) => !o);
					}}
					aria-expanded={open}
				>
					<Braces className="size-3.5" aria-hidden />
					Insert field
				</button>
			</div>
			{field}
			{open ? (
				<ul role="listbox" aria-label="Fields" className="toast-enter absolute right-0 top-8 z-20 grid w-48 rounded-lg border border-border bg-popover p-1 shadow-lg">
					{MERGE_TAGS.map((tag, i) => (
						<li key={tag} role="option" aria-selected={i === active}>
							<button
								type="button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => pick(tag)}
								className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm aria-selected:bg-secondary"
								aria-selected={i === active}
							>
								{MERGE_TAG_LABELS[tag]}
								<code className="text-xs text-muted-foreground">{`{{${tag}}}`}</code>
							</button>
						</li>
					))}
				</ul>
			) : null}
			{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
		</div>
	);
}
```

If `Input`/`Textarea` do not forward refs (check `src/components/ui/input.tsx`; React 19 passes `ref` as a prop to function components that spread props), the `ref` still works because the components spread `...props` onto the element.

- [ ] **Step 3: Block editor**

`src/components/email/block-editor.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ArrowDown, ArrowUp, CalendarDays, Copy, GripVertical, Heading, Image as ImageIcon, Minus, Monitor, MousePointerClick,
	MoveVertical, Redo2, Smartphone, Trash2, Type, Undo2,
} from "lucide-react";
import { newBlock, newEventBlock } from "@/lib/email/blocks";
import type { MergeValues } from "@/lib/email/merge";
import { pillResolver, renderBlockHtml, renderFooterHtml, renderHeaderHtml, valueResolver, type FooterInput } from "@/lib/email/render";
import type { EmailBlock, EmailBlockType } from "@/lib/email/types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TaggedField } from "./tagged-field";

export type EventOption = { id: string; title: string; when: string; place: string };
export type PreviewPerson = { label: string; values: MergeValues };

const PALETTE: { type: EmailBlockType; label: string; icon: typeof Type }[] = [
	{ type: "heading", label: "Heading", icon: Heading },
	{ type: "text", label: "Text", icon: Type },
	{ type: "button", label: "Button", icon: MousePointerClick },
	{ type: "image", label: "Image", icon: ImageIcon },
	{ type: "event", label: "Event", icon: CalendarDays },
	{ type: "divider", label: "Divider", icon: Minus },
	{ type: "spacer", label: "Spacer", icon: MoveVertical },
];

type Props = {
	blocks: EmailBlock[];
	onChange: (blocks: EmailBlock[]) => void;
	baseUrl: string;
	footer: FooterInput;
	people: PreviewPerson[];
	events: EventOption[];
	layout?: "wide" | "compact";
};

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void; label: string }) {
	return (
		<div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border bg-background p-0.5">
			{options.map((o) => (
				<button
					key={String(o.value)}
					type="button"
					role="radio"
					aria-checked={o.value === value}
					onClick={() => onChange(o.value)}
					className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm transition-colors aria-checked:bg-primary aria-checked:text-primary-foreground"
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

export function BlockEditor({ blocks, onChange, baseUrl, footer, people, events, layout = "wide" }: Props) {
	const [selectedId, setSelectedId] = useState<string | null>(blocks[0]?.id ?? null);
	const [width, setWidth] = useState<600 | 375>(600);
	const [person, setPerson] = useState(-1); // -1 shows fields as pills
	const [past, setPast] = useState<EmailBlock[][]>([]);
	const [future, setFuture] = useState<EmailBlock[][]>([]);
	const [dragId, setDragId] = useState<string | null>(null);
	const [drop, setDrop] = useState<{ index: number } | null>(null);
	const [eventPicker, setEventPicker] = useState(false);
	const lastCommit = useRef(0);
	const canvasRef = useRef<HTMLDivElement>(null);

	const resolve = person < 0 ? pillResolver : valueResolver(people[person].values);
	const header = useMemo(() => renderHeaderHtml(`${baseUrl}/code-logo-full-navy.png`), [baseUrl]);
	const footerHtml = useMemo(() => renderFooterHtml(footer), [footer]);
	const selected = blocks.find((b) => b.id === selectedId) ?? null;

	const commit = useCallback(
		(next: EmailBlock[], coalesce = false) => {
			const now = Date.now();
			if (!coalesce || now - lastCommit.current > 800) setPast((p) => [...p.slice(-49), blocks]);
			lastCommit.current = now;
			setFuture([]);
			onChange(next);
		},
		[blocks, onChange],
	);
	const undo = () => {
		const previous = past.at(-1);
		if (!previous) return;
		setPast((p) => p.slice(0, -1));
		setFuture((f) => [blocks, ...f]);
		onChange(previous);
	};
	const redo = () => {
		const next = future[0];
		if (!next) return;
		setFuture((f) => f.slice(1));
		setPast((p) => [...p, blocks]);
		onChange(next);
	};

	const insert = (block: EmailBlock) => {
		const at = selectedId ? blocks.findIndex((b) => b.id === selectedId) + 1 : blocks.length;
		commit([...blocks.slice(0, at), block, ...blocks.slice(at)]);
		setSelectedId(block.id);
		requestAnimationFrame(() => canvasRef.current?.querySelector(`[data-block-id="${block.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
	};
	const update = (id: string, props: object) => commit(blocks.map((b) => (b.id === id ? ({ ...b, props: { ...b.props, ...props } } as EmailBlock) : b)), true);
	const move = (id: string, delta: -1 | 1) => {
		const i = blocks.findIndex((b) => b.id === id);
		const j = i + delta;
		if (i < 0 || j < 0 || j >= blocks.length) return;
		const next = [...blocks];
		[next[i], next[j]] = [next[j], next[i]];
		commit(next);
	};
	const remove = (id: string) => {
		const i = blocks.findIndex((b) => b.id === id);
		commit(blocks.filter((b) => b.id !== id));
		setSelectedId(blocks[i + 1]?.id ?? blocks[i - 1]?.id ?? null);
	};
	const duplicate = (id: string) => {
		const source = blocks.find((b) => b.id === id);
		if (!source) return;
		const copy = { ...structuredClone(source), id: `blk_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}` };
		const i = blocks.findIndex((b) => b.id === id);
		commit([...blocks.slice(0, i + 1), copy, ...blocks.slice(i + 1)]);
		setSelectedId(copy.id);
	};
	const moveTo = (id: string, index: number) => {
		const from = blocks.findIndex((b) => b.id === id);
		if (from < 0) return;
		const next = blocks.filter((b) => b.id !== id);
		next.splice(index > from ? index - 1 : index, 0, blocks[from]);
		commit(next);
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			if (target.closest("input, textarea, select, [contenteditable]")) return;
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
				e.preventDefault();
				if (e.shiftKey) redo();
				else undo();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	const palette = (
		<div className={cn(layout === "wide" ? "grid content-start gap-1.5 md:grid-cols-1" : "flex gap-1.5 overflow-x-auto pb-1", "max-md:flex max-md:overflow-x-auto max-md:pb-1")}>
			{PALETTE.map(({ type, label, icon: Icon }) => (
				<button
					key={type}
					type="button"
					onClick={() => (type === "event" ? setEventPicker((o) => !o) : insert(newBlock(type as Exclude<EmailBlockType, "event">)))}
					className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-[transform,border-color] hover:border-accent active:scale-[0.97]"
				>
					<Icon className="size-4 text-muted-foreground" aria-hidden />
					{label}
				</button>
			))}
		</div>
	);

	const eventList = eventPicker ? (
		<div className="toast-enter grid max-h-64 gap-1 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
			{events.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No events yet.</p> : null}
			{events.map((event) => (
				<button
					key={event.id}
					type="button"
					onClick={() => {
						insert(newEventBlock({ eventId: event.id, title: event.title, when: event.when, place: event.place }));
						setEventPicker(false);
					}}
					className="grid rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary"
				>
					<span className="min-w-0 truncate font-medium">{event.title}</span>
					<span className="text-xs text-muted-foreground">{event.when}</span>
				</button>
			))}
		</div>
	) : null;

	const toolbar = (
		<div className="flex flex-wrap items-center justify-between gap-2">
			<div className="flex items-center gap-1">
				<button type="button" onClick={undo} disabled={past.length === 0} aria-label="Undo" className="rounded-md p-1.5 transition-colors hover:bg-secondary disabled:opacity-40">
					<Undo2 className="size-4" />
				</button>
				<button type="button" onClick={redo} disabled={future.length === 0} aria-label="Redo" className="rounded-md p-1.5 transition-colors hover:bg-secondary disabled:opacity-40">
					<Redo2 className="size-4" />
				</button>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<select
					aria-label="Preview as"
					value={person}
					onChange={(e) => setPerson(Number(e.target.value))}
					className="h-8 rounded-md border border-input bg-background px-2 text-sm"
				>
					<option value={-1}>Show fields</option>
					{people.map((p, i) => (
						<option key={p.label} value={i}>
							Preview as {p.label}
						</option>
					))}
				</select>
				<Segmented
					label="Preview width"
					value={width}
					onChange={setWidth}
					options={[
						{ value: 600, label: <><Monitor className="size-3.5" aria-hidden /> Desktop</> },
						{ value: 375, label: <><Smartphone className="size-3.5" aria-hidden /> Phone</> },
					]}
				/>
			</div>
		</div>
	);

	const canvas = (
		<div className="grid gap-3">
			{toolbar}
			<div ref={canvasRef} className="rounded-xl bg-[#F5F5F6] p-3 sm:px-14 sm:py-6">
				<div className="mx-auto rounded-xl bg-white shadow-sm transition-[max-width] duration-300 ease-out motion-reduce:transition-none" style={{ maxWidth: width }}>
					<table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
						<tbody dangerouslySetInnerHTML={{ __html: header }} />
					</table>
					{blocks.length === 0 ? (
						<p className="px-8 py-10 text-center text-sm text-muted-foreground">Add a block from the list to start writing.</p>
					) : null}
					{blocks.map((block, index) => {
						const isSelected = block.id === selectedId;
						return (
							<div
								key={block.id}
								data-block-id={block.id}
								onClick={() => setSelectedId(block.id)}
								onDragOver={(e) => {
									if (!dragId) return;
									e.preventDefault();
									const rect = e.currentTarget.getBoundingClientRect();
									setDrop({ index: e.clientY < rect.top + rect.height / 2 ? index : index + 1 });
								}}
								onDrop={(e) => {
									e.preventDefault();
									if (dragId && drop) moveTo(dragId, drop.index);
									setDragId(null);
									setDrop(null);
								}}
								className={cn(
									"row-enter group relative cursor-pointer transition-[transform,box-shadow,opacity] duration-150",
									isSelected ? "outline outline-2 -outline-offset-2 outline-[#4986AC]" : "hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-[#90B4CC]",
									dragId === block.id && "scale-[1.02] opacity-60 shadow-lg",
								)}
							>
								{drop?.index === index ? <div className="absolute inset-x-2 -top-px z-10 h-0.5 rounded bg-[#06192F]" aria-hidden /> : null}
								{drop?.index === index + 1 && index === blocks.length - 1 ? <div className="absolute inset-x-2 -bottom-px z-10 h-0.5 rounded bg-[#06192F]" aria-hidden /> : null}
								<button
									type="button"
									draggable
									onDragStart={(e) => {
										setDragId(block.id);
										e.dataTransfer.effectAllowed = "move";
									}}
									onDragEnd={() => {
										setDragId(null);
										setDrop(null);
									}}
									aria-label="Drag to reorder"
									className="absolute -left-10 top-2 hidden cursor-grab rounded p-1 text-muted-foreground hover:bg-secondary sm:group-hover:block"
								>
									<GripVertical className="size-4" />
								</button>
								<table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
									<tbody dangerouslySetInnerHTML={{ __html: renderBlockHtml(block, resolve, baseUrl) }} />
								</table>
								{isSelected ? (
									<div className="toast-enter absolute right-1 top-1 z-10 flex gap-0.5 rounded-lg border border-border bg-card p-0.5 shadow-md sm:-right-12 sm:flex-col">
										<button type="button" aria-label="Move up" onClick={(e) => { e.stopPropagation(); move(block.id, -1); }} className="rounded p-1 hover:bg-secondary">
											<ArrowUp className="size-4" />
										</button>
										<button type="button" aria-label="Move down" onClick={(e) => { e.stopPropagation(); move(block.id, 1); }} className="rounded p-1 hover:bg-secondary">
											<ArrowDown className="size-4" />
										</button>
										<button type="button" aria-label="Duplicate" onClick={(e) => { e.stopPropagation(); duplicate(block.id); }} className="rounded p-1 hover:bg-secondary">
											<Copy className="size-4" />
										</button>
										<button type="button" aria-label="Delete" onClick={(e) => { e.stopPropagation(); remove(block.id); }} className="rounded p-1 hover:bg-secondary">
											<Trash2 className="size-4" />
										</button>
									</div>
								) : null}
							</div>
						);
					})}
					<table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
						<tbody dangerouslySetInnerHTML={{ __html: footerHtml }} />
					</table>
				</div>
			</div>
		</div>
	);

	const inspector = (
		<div className="grid content-start gap-4 rounded-xl border border-border bg-card p-4">
			{!selected ? <p className="text-sm text-muted-foreground">Select a block to edit it.</p> : null}
			{selected?.type === "heading" ? (
				<>
					<TaggedField label="Heading" value={selected.props.text} maxLength={200} onChange={(text) => update(selected.id, { text })} />
					<Segmented label="Heading size" value={selected.props.level} onChange={(level) => update(selected.id, { level })} options={[{ value: 1, label: "Large" }, { value: 2, label: "Small" }]} />
				</>
			) : null}
			{selected?.type === "text" ? (
				<TaggedField
					label="Text"
					multiline
					rows={8}
					maxLength={5000}
					value={selected.props.text}
					onChange={(text) => update(selected.id, { text })}
					hint="**bold**, *italic*, [link text](https://...). A blank line starts a new paragraph."
				/>
			) : null}
			{selected?.type === "button" ? (
				<>
					<TaggedField label="Button label" value={selected.props.label} maxLength={80} onChange={(label) => update(selected.id, { label })} />
					<label className="grid gap-2 text-sm font-medium">
						Link
						<Input value={selected.props.href} onChange={(e) => update(selected.id, { href: e.target.value })} placeholder="https://" />
					</label>
				</>
			) : null}
			{selected?.type === "image" ? (
				<>
					<label className="grid gap-2 text-sm font-medium">
						Image URL
						<Input value={selected.props.src} onChange={(e) => update(selected.id, { src: e.target.value })} placeholder="https://" />
					</label>
					<label className="grid gap-2 text-sm font-medium">
						Description for screen readers
						<Input value={selected.props.alt} maxLength={200} onChange={(e) => update(selected.id, { alt: e.target.value })} />
					</label>
					<label className="grid gap-2 text-sm font-medium">
						Link (optional)
						<Input value={selected.props.href ?? ""} onChange={(e) => update(selected.id, { href: e.target.value || undefined })} placeholder="https://" />
					</label>
				</>
			) : null}
			{selected?.type === "spacer" ? (
				<Segmented label="Space" value={selected.props.size} onChange={(size) => update(selected.id, { size })} options={[{ value: "sm", label: "Small" }, { value: "md", label: "Medium" }, { value: "lg", label: "Large" }]} />
			) : null}
			{selected?.type === "divider" ? <p className="text-sm text-muted-foreground">A thin line between sections. No settings.</p> : null}
			{selected?.type === "event" ? (
				<label className="grid gap-2 text-sm font-medium">
					Event
					<select
						value={selected.props.eventId}
						onChange={(e) => {
							const event = events.find((ev) => ev.id === e.target.value);
							if (event) update(selected.id, { eventId: event.id, title: event.title, when: event.when, place: event.place, path: `/portal/calendar/${event.id}` });
						}}
						className="h-9 rounded-md border border-input bg-background px-3 text-sm"
					>
						{events.map((event) => (
							<option key={event.id} value={event.id}>
								{event.title} ({event.when})
							</option>
						))}
					</select>
					<span className="text-xs font-normal text-muted-foreground">Title, time, and place refresh when the email is scheduled.</span>
				</label>
			) : null}
		</div>
	);

	if (layout === "compact") {
		return (
			<div className="grid gap-3">
				{palette}
				{eventList}
				{canvas}
				{inspector}
			</div>
		);
	}
	return (
		<div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)] xl:grid-cols-[180px_minmax(0,1fr)_300px]">
			<div className="grid content-start gap-2">
				{palette}
				{eventList}
			</div>
			{canvas}
			<div className="md:col-span-2 xl:col-span-1">{inspector}</div>
		</div>
	);
}
```

- [ ] **Step 4: Templates library**

`src/app/portal/admin/email/templates/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { getRepositories } from "@/db";
import { Input } from "@/components/ui/input";
import { SAMPLE_MERGE_VALUES } from "@/lib/email/merge";
import { renderEmail, valueResolver } from "@/lib/email/render";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { emailConfigFromEnv } from "@/server/email/db";
import { formatManila } from "../campaign-row";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
	const actor = await requireActor();
	if (!can(actor, "email:configure")) redirect("/portal/admin/email");
	const { q = "" } = await searchParams;
	const { email } = await getRepositories();
	const templates = await email.templates.list(actor, { q });
	const { publicBaseUrl } = emailConfigFromEnv();

	return (
		<div className="grid gap-6">
			<header className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="font-heading text-3xl">Templates</h1>
					<p className="text-sm text-muted-foreground">Reusable designs. Editing a template never changes emails already sent.</p>
				</div>
				<form className="relative w-full sm:w-64">
					<Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
					<Input name="q" defaultValue={q} placeholder="Search templates" className="pl-8" aria-label="Search templates" />
				</form>
			</header>
			<ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
				<li className="row-enter">
					<Link
						href="/portal/admin/email/templates/new"
						className="flex h-full min-h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-muted-foreground transition-[border-color,color,transform] hover:border-accent hover:text-foreground active:scale-[0.99]"
					>
						<Plus className="size-5" aria-hidden />
						New template
					</Link>
				</li>
				{templates.map((t, i) => {
					const { bodyHtml } = renderEmail({
						subject: t.subject,
						preheader: t.preheader,
						blocks: t.blocks,
						resolve: valueResolver(SAMPLE_MERGE_VALUES),
						values: SAMPLE_MERGE_VALUES,
						baseUrl: publicBaseUrl,
						footer: { categoryName: t.categoryName ?? "CODE", required: true, archiveUrl: null, preferencesUrl: "#", unsubscribeUrl: null },
					});
					return (
						<li key={t.id} className="row-enter" style={{ animationDelay: `${Math.min(i + 1, 8) * 30}ms` }}>
							<Link
								href={`/portal/admin/email/templates/${t.id}`}
								className="group grid overflow-hidden rounded-xl border border-border bg-card transition-[border-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-accent hover:shadow-md motion-reduce:hover:translate-y-0"
							>
								<div className="pointer-events-none relative h-44 overflow-hidden bg-[#F5F5F6]" aria-hidden>
									<div className="absolute left-1/2 top-3 w-[600px] origin-top -translate-x-1/2 scale-[0.5]" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
								</div>
								<div className="grid gap-0.5 border-t border-border p-3">
									<span className="min-w-0 truncate font-medium">{t.name}</span>
									<span className="text-sm text-muted-foreground">
										Updated {formatManila(t.updatedAt).split(",")[0]} · used {t.usedCount}×
									</span>
								</div>
							</Link>
						</li>
					);
				})}
			</ul>
			{templates.length === 0 && q ? <p className="text-sm text-muted-foreground">No templates match &quot;{q}&quot;.</p> : null}
		</div>
	);
}
```

- [ ] **Step 5: Template editor page**

`src/app/portal/admin/email/templates/[id]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { formatEventWhen } from "@/db/repositories/email-campaigns";
import { mergeValuesFor, SAMPLE_MERGE_VALUES } from "@/lib/email/merge";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { emailConfigFromEnv } from "@/server/email/db";
import { TemplateEditor } from "./template-editor";

export const dynamic = "force-dynamic";

export default async function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
	const actor = await requireActor();
	if (!can(actor, "email:configure")) redirect("/portal/admin/email");
	const { id } = await params;
	const repos = await getRepositories();
	const [template, categories, options, me] = await Promise.all([
		id === "new" ? Promise.resolve(null) : repos.email.templates.get(actor, id),
		repos.email.settings.listCategories(actor),
		repos.email.campaigns.audienceOptions(actor),
		repos.members.getById(actor, actor.memberId),
	]);
	if (id !== "new" && !template) notFound();
	const { publicBaseUrl } = emailConfigFromEnv();
	return (
		<TemplateEditor
			initial={
				template ?? { id: null, name: "", categoryId: categories[0]?.id ?? null, subject: "", preheader: "", blocks: [] }
			}
			categories={categories.map((c) => ({ id: c.id, name: c.name, required: c.required }))}
			events={options.events.map((e) => ({ id: e.id, title: e.title, when: formatEventWhen(e.startsAt), place: e.place }))}
			people={[
				{ label: "a sample member", values: SAMPLE_MERGE_VALUES },
				...(me ? [{ label: "you", values: mergeValuesFor(me) }] : []),
			]}
			baseUrl={publicBaseUrl}
		/>
	);
}
```

`src/app/portal/admin/email/templates/[id]/template-editor.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowLeft, Copy, Send } from "lucide-react";
import { BlockEditor, type EventOption, type PreviewPerson } from "@/components/email/block-editor";
import { TaggedField } from "@/components/email/tagged-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { EmailBlock } from "@/lib/email/types";
import { duplicateTemplateAction, saveTemplateAction, setTemplateArchivedAction } from "../../actions";
import { useAutosave } from "../../use-autosave";

type Initial = { id: string | null; name: string; categoryId: string | null; subject: string; preheader: string; blocks: EmailBlock[] };

export function TemplateEditor({
	initial,
	categories,
	events,
	people,
	baseUrl,
}: {
	initial: Initial;
	categories: { id: string; name: string; required: boolean }[];
	events: EventOption[];
	people: PreviewPerson[];
	baseUrl: string;
}) {
	const router = useRouter();
	const toast = useToast();
	const [id, setId] = useState(initial.id);
	const [name, setName] = useState(initial.name);
	const [categoryId, setCategoryId] = useState(initial.categoryId);
	const [subject, setSubject] = useState(initial.subject);
	const [preheader, setPreheader] = useState(initial.preheader);
	const [blocks, setBlocks] = useState(initial.blocks);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const category = categories.find((c) => c.id === categoryId);

	const value = useMemo(() => ({ name, categoryId, subject, preheader, blocks }), [name, categoryId, subject, preheader, blocks]);
	const { state } = useAutosave(value, async (v) => {
		if (!v.name.trim()) {
			setError("Name the template to save it.");
			return false;
		}
		const result = await saveTemplateAction({ id: id ?? undefined, ...v });
		if (!result.ok) {
			setError(result.error);
			return false;
		}
		setError(null);
		if (!id) {
			setId(result.data);
			window.history.replaceState(null, "", `/portal/admin/email/templates/${result.data}`);
		}
		return true;
	});

	const footer = useMemo(
		() => ({ categoryName: category?.name ?? "CODE", required: category?.required ?? true, archiveUrl: `${baseUrl}/portal/mail`, preferencesUrl: `${baseUrl}/portal/mail/preferences`, unsubscribeUrl: category && !category.required ? `${baseUrl}/unsubscribe` : null }),
		[category, baseUrl],
	);

	return (
		<div className="grid gap-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link href="/portal/admin/email/templates" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
					<ArrowLeft className="size-4" aria-hidden />
					Templates
				</Link>
				<div className="flex flex-wrap items-center gap-2">
					<span aria-live="polite" className="text-sm text-muted-foreground">
						{state === "saving" ? "Saving..." : state === "saved" ? "Saved" : state === "error" ? (error ?? "Not saved") : ""}
					</span>
					{id ? (
						<>
							<Button
								variant="ghost"
								disabled={pending}
								onClick={() =>
									startTransition(async () => {
										const result = await duplicateTemplateAction(id);
										if (result.ok) router.push(`/portal/admin/email/templates/${result.data}`);
										else toast({ message: result.error });
									})
								}
							>
								<Copy />
								Duplicate
							</Button>
							<Button
								variant="ghost"
								disabled={pending}
								onClick={() =>
									startTransition(async () => {
										const result = await setTemplateArchivedAction(id, true);
										if (!result.ok) return toast({ message: result.error });
										router.push("/portal/admin/email/templates");
									})
								}
							>
								Archive
							</Button>
							<Button asChild>
								<Link href={`/portal/admin/email/new?template=${id}`}>
									<Send />
									Use in new email
								</Link>
							</Button>
						</>
					) : null}
				</div>
			</div>

			<div className="grid gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-2">
				<label className="grid gap-2 text-sm font-medium">
					Template name
					<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly update" maxLength={80} autoFocus={!initial.id} />
				</label>
				<label className="grid gap-2 text-sm font-medium">
					Default category
					<select value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value || null)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
						<option value="">None</option>
						{categories.map((c) => (
							<option key={c.id} value={c.id}>
								{c.name}
								{c.required ? " (required)" : ""}
							</option>
						))}
					</select>
				</label>
				<TaggedField label="Subject" value={subject} onChange={setSubject} maxLength={200} placeholder="This week at CODE" />
				<TaggedField label="Preview text" value={preheader} onChange={setPreheader} maxLength={200} hint="Shown after the subject in most inboxes." />
			</div>

			<BlockEditor blocks={blocks} onChange={setBlocks} baseUrl={baseUrl} footer={footer} people={people} events={events} layout="wide" />
		</div>
	);
}
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add src/components/email/tagged-field.tsx src/components/email/block-editor.tsx src/app/portal/admin/email/use-autosave.ts src/app/portal/admin/email/templates
git commit -m "feat(email): add block editor, merge tag field, and template library"
```

---

### Task 16: Audience picker and composer

**Files:**
- Create: `src/components/email/audience-picker.tsx`
- Create: `src/app/portal/admin/email/composer.tsx`
- Create: `src/app/portal/admin/email/composer-data.ts`
- Create: `src/app/portal/admin/email/new/page.tsx`
- Create: `src/app/portal/admin/email/sends/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `previewAudienceAction`, `searchMembersAction`, `saveCampaignAction`, `testSendAction`, `scheduleCampaignAction` (Task 13); `email.campaigns.labelsFor` (Task 8); `BlockEditor`, `TaggedField`, `useAutosave` (Task 15); `AudienceOptions`, `AudiencePreview`, `formatEventWhen` (Task 8); `toLocalInput` (`src/lib/date-slots.ts`).
- Produces:
  - `AudiencePicker({ value, onChange, options, memberLabels, categoryId, onPreview })`
  - `ruleLabel(rule: AudienceRule, options: AudienceOptions, memberLabels: Record<string, string>): string`
  - `Composer(props: ComposerProps)`
  - `loadComposerData(actor, campaign: { audience: Audience } | null): Promise<Omit<ComposerProps, "initial">>`

- [ ] **Step 1: Audience picker**

`src/components/email/audience-picker.tsx`:

```tsx
"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Users, X } from "lucide-react";
import type { AudienceOptions, AudiencePreview } from "@/db/repositories/email-campaigns";
import type { Audience, AudienceRule } from "@/lib/email/types";
import { cn } from "@/lib/utils";
import { previewAudienceAction, searchMembersAction } from "@/app/portal/admin/email/actions";

type Suggestion = { rule: AudienceRule; label: string; hint: string };
const keyOf = (rule: AudienceRule) => JSON.stringify(rule);
const DATE = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", month: "short", day: "numeric" });
const RELATION = { rsvp: "RSVP'd to", attended: "Attended", no_show: "RSVP'd but missed" } as const;

export function ruleLabel(rule: AudienceRule, options: AudienceOptions, memberLabels: Record<string, string>): string {
	switch (rule.kind) {
		case "roster":
			return rule.termId === "current" ? "Current member list" : "Member list";
		case "role":
			return `Role: ${options.roles.find((r) => r.key === rule.roleKey)?.label ?? rule.roleKey}`;
		case "batch":
			return `Batch ${rule.batch}`;
		case "status":
			return `Status: ${rule.status}`;
		case "event":
			return `${RELATION[rule.relation]} ${options.events.find((e) => e.id === rule.eventId)?.title ?? "an event"}`;
		case "member":
			return memberLabels[rule.memberId] ?? "A member";
	}
}

function baseSuggestions(options: AudienceOptions): Suggestion[] {
	return [
		{ rule: { kind: "roster", termId: "current" }, label: "Current member list", hint: options.currentTermName ?? "No active school year" },
		...options.roles.map((r) => ({ rule: { kind: "role", roleKey: r.key } as AudienceRule, label: `Role: ${r.label}`, hint: "Admin role" })),
		...options.batches.map((b) => ({ rule: { kind: "batch", batch: b } as AudienceRule, label: `Batch ${b}`, hint: "Batch" })),
		...(["active", "pending", "inactive"] as const).map((s) => ({ rule: { kind: "status", status: s } as AudienceRule, label: `Status: ${s}`, hint: "Member status" })),
		...options.events.flatMap((e) =>
			(["rsvp", "attended", "no_show"] as const).map((relation) => ({
				rule: { kind: "event", eventId: e.id, relation } as AudienceRule,
				label: `${RELATION[relation]} ${e.title}`,
				hint: DATE.format(e.startsAt),
			})),
		),
	];
}

function TokenField({
	label,
	rules,
	onChange,
	options,
	memberLabels,
	onLabel,
}: {
	label: string;
	rules: AudienceRule[];
	onChange: (rules: AudienceRule[]) => void;
	options: AudienceOptions;
	memberLabels: Record<string, string>;
	onLabel: (memberId: string, name: string) => void;
}) {
	const listId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const [people, setPeople] = useState<Suggestion[]>([]);
	const base = useMemo(() => baseSuggestions(options), [options]);
	const chosen = new Set(rules.map(keyOf));

	useEffect(() => {
		const q = query.trim();
		if (q.length < 2) {
			setPeople([]);
			return;
		}
		const timer = window.setTimeout(async () => {
			const result = await searchMembersAction(q);
			if (result.ok) {
				setPeople(result.data.map((m) => ({ rule: { kind: "member", memberId: m.id }, label: m.name, hint: m.batch ? `${m.email} · ${m.batch}` : m.email })));
			}
		}, 250);
		return () => window.clearTimeout(timer);
	}, [query]);

	const q = query.trim().toLowerCase();
	const matches = (q ? [...base.filter((s) => s.label.toLowerCase().includes(q)), ...people] : base.slice(0, 12)).filter((s) => !chosen.has(keyOf(s.rule))).slice(0, 10);

	const add = (s: Suggestion) => {
		if (s.rule.kind === "member") onLabel(s.rule.memberId, s.label);
		onChange([...rules, s.rule]);
		setQuery("");
		setActive(0);
		inputRef.current?.focus();
	};

	return (
		<div className="relative grid gap-2">
			<span className="text-sm font-medium">{label}</span>
			<div
				className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring"
				onClick={() => inputRef.current?.focus()}
			>
				{rules.map((rule) => (
					<span key={keyOf(rule)} className="row-enter inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-sm text-secondary-foreground">
						<span className="min-w-0 break-all">{ruleLabel(rule, options, memberLabels)}</span>
						<button
							type="button"
							aria-label={`Remove ${ruleLabel(rule, options, memberLabels)}`}
							onClick={() => onChange(rules.filter((r) => keyOf(r) !== keyOf(rule)))}
							className="shrink-0 rounded-full p-0.5 hover:bg-background/60"
						>
							<X className="size-3.5" />
						</button>
					</span>
				))}
				<input
					ref={inputRef}
					role="combobox"
					aria-expanded={open}
					aria-controls={listId}
					aria-label={label}
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setOpen(true);
						setActive(0);
					}}
					onFocus={() => setOpen(true)}
					onBlur={() => window.setTimeout(() => setOpen(false), 120)}
					onKeyDown={(e) => {
						if (e.key === "ArrowDown") {
							e.preventDefault();
							setActive((i) => Math.min(i + 1, matches.length - 1));
						} else if (e.key === "ArrowUp") {
							e.preventDefault();
							setActive((i) => Math.max(i - 1, 0));
						} else if (e.key === "Enter" && matches[active]) {
							e.preventDefault();
							add(matches[active]);
						} else if (e.key === "Backspace" && !query && rules.length > 0) {
							onChange(rules.slice(0, -1));
						} else if (e.key === "Escape") {
							setOpen(false);
						}
					}}
					placeholder={rules.length ? "Add more" : "Search groups, events, or members"}
					className="min-w-40 flex-1 bg-transparent px-1 py-1 text-sm outline-none"
				/>
			</div>
			{open && matches.length > 0 ? (
				<ul id={listId} role="listbox" className="toast-enter absolute top-full z-20 mt-1 grid max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
					{matches.map((s, i) => (
						<li key={keyOf(s.rule)} role="option" aria-selected={i === active}>
							<button
								type="button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => add(s)}
								onMouseEnter={() => setActive(i)}
								className={cn("flex w-full min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm", i === active && "bg-secondary")}
							>
								<span className="min-w-0 truncate">{s.label}</span>
								<span className="shrink-0 text-xs text-muted-foreground">{s.hint}</span>
							</button>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

export function AudiencePicker({
	value,
	onChange,
	options,
	memberLabels: initialLabels,
	categoryId,
	categoryName,
	onPreview,
}: {
	value: Audience;
	onChange: (audience: Audience) => void;
	options: AudienceOptions;
	memberLabels: Record<string, string>;
	categoryId: string | null;
	categoryName: string | null;
	onPreview: (preview: AudiencePreview | null) => void;
}) {
	const [labels, setLabels] = useState(initialLabels);
	const [preview, setPreview] = useState<AudiencePreview | null>(null);
	const [loading, setLoading] = useState(false);
	const [showExclude, setShowExclude] = useState(value.exclude.length > 0);
	const [expanded, setExpanded] = useState<"recipients" | "optedOut" | null>(null);
	const onLabel = (memberId: string, name: string) => setLabels((l) => ({ ...l, [memberId]: name }));

	useEffect(() => {
		if (value.include.length === 0) {
			setPreview(null);
			onPreview(null);
			return;
		}
		setLoading(true);
		const timer = window.setTimeout(async () => {
			const result = await previewAudienceAction(value, categoryId);
			setLoading(false);
			if (result.ok) {
				setPreview(result.data);
				onPreview(result.data);
			}
		}, 300);
		return () => window.clearTimeout(timer);
		// onPreview is a stable setter from the parent.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value, categoryId]);

	return (
		<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
			<div className="grid content-start gap-3">
				<TokenField label="Send to" rules={value.include} onChange={(include) => onChange({ ...value, include })} options={options} memberLabels={labels} onLabel={onLabel} />
				{value.include.filter((r) => r.kind !== "member").length > 1 ? (
					<div className="flex flex-wrap items-center gap-2 text-sm">
						<span className="text-muted-foreground">Members who match</span>
						{(["any", "all"] as const).map((match) => (
							<button
								key={match}
								type="button"
								aria-pressed={value.match === match}
								onClick={() => onChange({ ...value, match })}
								className="rounded-full border border-border px-3 py-1 transition-colors aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
							>
								{match === "any" ? "any group" : "every group"}
							</button>
						))}
						<span className="text-muted-foreground">Hand-picked members are always included.</span>
					</div>
				) : null}
				{showExclude ? (
					<TokenField label="Don't send to" rules={value.exclude} onChange={(exclude) => onChange({ ...value, exclude })} options={options} memberLabels={labels} onLabel={onLabel} />
				) : (
					<button type="button" onClick={() => setShowExclude(true)} className="justify-self-start text-sm text-accent underline-offset-2 hover:underline">
						Leave some people out
					</button>
				)}
			</div>

			<div className="grid content-start gap-2 rounded-xl border border-border bg-secondary/40 p-4" aria-live="polite">
				<div className="flex items-center gap-2 text-muted-foreground">
					<Users className="size-4" aria-hidden />
					<span className="text-sm">Will receive</span>
				</div>
				<p className={cn("font-heading text-4xl tabular-nums transition-opacity", loading && "opacity-40")}>
					{value.include.length === 0 ? "0" : loading && !preview ? "..." : (preview?.willReceive ?? 0)}
				</p>
				{preview ? (
					<div className="grid gap-1 text-sm text-muted-foreground">
						<span>of {preview.matched} matched</span>
						{preview.optedOut.length > 0 ? (
							<button type="button" className="flex items-center gap-1 text-left underline-offset-2 hover:underline" onClick={() => setExpanded(expanded === "optedOut" ? null : "optedOut")}>
								{preview.optedOut.length} opted out of {categoryName ?? "this category"}
								<ChevronDown className={cn("size-3.5 transition-transform", expanded === "optedOut" && "rotate-180")} aria-hidden />
							</button>
						) : null}
						{preview.willReceive > 0 ? (
							<button type="button" className="flex items-center gap-1 text-left underline-offset-2 hover:underline" onClick={() => setExpanded(expanded === "recipients" ? null : "recipients")}>
								See who
								<ChevronDown className={cn("size-3.5 transition-transform", expanded === "recipients" && "rotate-180")} aria-hidden />
							</button>
						) : null}
						{expanded ? (
							<ul className="row-enter mt-1 grid max-h-48 gap-0.5 overflow-y-auto text-foreground">
								{(expanded === "optedOut" ? preview.optedOut : preview.recipients).map((m) => (
									<li key={m.memberId} className="min-w-0 truncate">
										{m.name}
									</li>
								))}
								{expanded === "recipients" && preview.willReceive > preview.recipients.length ? (
									<li className="text-muted-foreground">and {preview.willReceive - preview.recipients.length} more</li>
								) : null}
							</ul>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}
```

`src/components/email/audience-picker.tsx` imports server actions from the app route. That is valid in Next (server action references cross into client components).

- [ ] **Step 2: Shared composer data loader**

`src/app/portal/admin/email/composer-data.ts`:

```ts
import { getRepositories } from "@/db";
import { formatEventWhen } from "@/db/repositories/email-campaigns";
import { mergeValuesFor, SAMPLE_MERGE_VALUES } from "@/lib/email/merge";
import type { Audience } from "@/lib/email/types";
import type { Actor } from "@/server/auth/permissions";
import { emailConfigFromEnv } from "@/server/email/db";

export async function loadComposerData(actor: Actor, audience: Audience | null) {
	const repos = await getRepositories();
	const memberIds = [...(audience?.include ?? []), ...(audience?.exclude ?? [])].flatMap((r) => (r.kind === "member" ? [r.memberId] : []));
	const [senders, categories, templates, options, me, memberLabels] = await Promise.all([
		repos.email.settings.listSenders(actor),
		repos.email.settings.listCategories(actor),
		repos.email.templates.list(actor),
		repos.email.campaigns.audienceOptions(actor),
		repos.members.getById(actor, actor.memberId),
		repos.email.campaigns.labelsFor(actor, memberIds),
	]);
	return {
		senders: senders.map((s) => ({ id: s.id, address: s.address, displayName: s.displayName })),
		categories: categories.map((c) => ({ id: c.id, name: c.name, required: c.required, defaultSenderId: c.defaultSenderId })),
		templates: templates.map((t) => ({ id: t.id, name: t.name, categoryId: t.categoryId, subject: t.subject, preheader: t.preheader, blocks: t.blocks })),
		options,
		memberLabels,
		events: options.events.map((e) => ({ id: e.id, title: e.title, when: formatEventWhen(e.startsAt), place: e.place })),
		people: [{ label: "a sample member", values: SAMPLE_MERGE_VALUES }, ...(me ? [{ label: "you", values: mergeValuesFor(me) }] : [])],
		baseUrl: emailConfigFromEnv().publicBaseUrl,
	};
}
```

- [ ] **Step 3: Composer**

`src/app/portal/admin/email/composer.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, Check, CircleAlert, FlaskConical, Send } from "lucide-react";
import { AudiencePicker, ruleLabel } from "@/components/email/audience-picker";
import { BlockEditor, type EventOption, type PreviewPerson } from "@/components/email/block-editor";
import { TaggedField } from "@/components/email/tagged-field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { AudienceOptions, AudiencePreview } from "@/db/repositories/email-campaigns";
import { toLocalInput } from "@/lib/date-slots";
import type { Audience, EmailBlock, EmailCampaignStatus } from "@/lib/email/types";
import { cn } from "@/lib/utils";
import { saveCampaignAction, scheduleCampaignAction, testSendAction } from "./actions";
import { useAutosave } from "./use-autosave";

export type ComposerProps = {
	initial: {
		id: string | null;
		templateId: string | null;
		categoryId: string | null;
		senderId: string | null;
		subject: string;
		preheader: string;
		blocks: EmailBlock[];
		audience: Audience;
		status: EmailCampaignStatus;
	};
	senders: { id: string; address: string; displayName: string }[];
	categories: { id: string; name: string; required: boolean; defaultSenderId: string | null }[];
	templates: { id: string; name: string; categoryId: string | null; subject: string; preheader: string; blocks: EmailBlock[] }[];
	options: AudienceOptions;
	memberLabels: Record<string, string>;
	events: EventOption[];
	people: PreviewPerson[];
	baseUrl: string;
};

const MANILA = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Step({ n, title, done, summary, children, open, onToggle }: { n: number; title: string; done: boolean; summary: string; children: React.ReactNode; open: boolean; onToggle: () => void }) {
	return (
		<section className="rounded-xl border border-border bg-card">
			<button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full min-w-0 items-center gap-3 p-4 text-left">
				<span
					className={cn(
						"grid size-7 shrink-0 place-items-center rounded-full border text-sm tabular-nums transition-colors duration-200",
						done ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground",
					)}
					aria-hidden
				>
					{done ? <Check className="check-pop size-4" /> : n}
				</span>
				<span className="grid min-w-0 flex-1">
					<span className="font-medium">{title}</span>
					{!open ? <span className="min-w-0 truncate text-sm text-muted-foreground">{summary}</span> : null}
				</span>
				<span className="shrink-0 text-sm text-accent">{open ? "Done" : "Edit"}</span>
			</button>
			{open ? <div className="row-enter border-t border-border p-4">{children}</div> : null}
		</section>
	);
}

export function Composer(props: ComposerProps) {
	const { initial, senders, categories, templates, options, memberLabels, events, people, baseUrl } = props;
	const router = useRouter();
	const toast = useToast();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [id, setId] = useState(initial.id);
	const [templateId, setTemplateId] = useState(initial.templateId);
	const [categoryId, setCategoryId] = useState(initial.categoryId);
	const [senderId, setSenderId] = useState(initial.senderId);
	const [subject, setSubject] = useState(initial.subject);
	const [preheader, setPreheader] = useState(initial.preheader);
	const [blocks, setBlocks] = useState(initial.blocks);
	const [audience, setAudience] = useState(initial.audience);
	const [preview, setPreview] = useState<AudiencePreview | null>(null);
	const [timing, setTiming] = useState<"now" | "at">("now");
	const [at, setAt] = useState(() => toLocalInput(new Date(Date.now() + 24 * 60 * 60_000)).slice(0, 11) + "09:00");
	const [open, setOpen] = useState<number | null>(initial.id ? null : 1);
	const [sent, setSent] = useState(false);
	const [pending, startTransition] = useTransition();
	const category = categories.find((c) => c.id === categoryId) ?? null;
	const sender = senders.find((s) => s.id === senderId) ?? null;

	const value = useMemo(
		() => ({ templateId, categoryId, senderId, subject, preheader, blocks, audience }),
		[templateId, categoryId, senderId, subject, preheader, blocks, audience],
	);
	const { state, flush } = useAutosave(value, async (v) => {
		const result = await saveCampaignAction({ id: id ?? undefined, ...v });
		if (!result.ok) {
			toast({ message: result.error });
			return false;
		}
		if (!id) {
			setId(result.data.id);
			window.history.replaceState(null, "", `/portal/admin/email/sends/${result.data.id}/edit`);
		}
		return true;
	});

	useEffect(() => {
		if (category?.defaultSenderId && !senderId) setSenderId(category.defaultSenderId);
	}, [category, senderId]);

	const checks = {
		sender: Boolean(sender && category),
		audience: audience.include.length > 0 && (preview?.willReceive ?? 0) > 0,
		subject: subject.trim().length > 0,
		content: blocks.length > 0,
	};
	const ready = checks.sender && checks.audience && checks.subject && checks.content;
	const audienceSummary = audience.include.length ? audience.include.map((r) => ruleLabel(r, options, memberLabels)).join(", ") : "No one yet";
	const whenLabel = timing === "now" ? "Now (you have 2 minutes to undo)" : `${MANILA.format(new Date(`${at}:00+08:00`))} Manila time`;
	const primaryLabel = timing === "now" ? `Send to ${preview?.willReceive ?? 0} members` : `Schedule for ${MANILA.format(new Date(`${at}:00+08:00`))}`;

	const footer = useMemo(
		() => ({
			categoryName: category?.name ?? "CODE",
			required: category?.required ?? true,
			archiveUrl: `${baseUrl}/portal/mail`,
			preferencesUrl: `${baseUrl}/portal/mail/preferences`,
			unsubscribeUrl: category && !category.required ? `${baseUrl}/unsubscribe` : null,
		}),
		[category, baseUrl],
	);

	const applyTemplate = (t: ComposerProps["templates"][number]) => {
		setTemplateId(t.id);
		setSubject(t.subject);
		setPreheader(t.preheader);
		setBlocks(t.blocks);
		if (t.categoryId) setCategoryId(t.categoryId);
		toast({ message: `Started from ${t.name}.` });
	};

	const testSend = () =>
		startTransition(async () => {
			const result = await testSendAction({ subject, preheader, blocks, categoryId, senderId });
			toast({ message: result.ok ? `Test sent to ${result.data.to}.` : result.error });
		});

	const confirm = () =>
		startTransition(async () => {
			if (!(await flush())) return;
			const campaignId = id;
			if (!campaignId) return toast({ message: "Save the email first." });
			const result = await scheduleCampaignAction(campaignId, timing === "now" ? { mode: "now" } : { mode: "at", local: at });
			if (!result.ok) return toast({ message: result.error });
			setSent(true);
			window.setTimeout(() => router.push(`/portal/admin/email/sends/${campaignId}`), 650);
		});

	const toggle = (n: number) => setOpen((o) => (o === n ? null : n));
	const saveLabel = state === "saving" ? "Saving..." : state === "saved" ? "Draft saved" : state === "error" ? "Not saved" : "";

	return (
		<div className="grid gap-5 pb-24 lg:pb-0">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link href="/portal/admin/email" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
					<ArrowLeft className="size-4" aria-hidden />
					Email
				</Link>
				<span aria-live="polite" className="text-sm text-muted-foreground">
					{saveLabel}
				</span>
			</div>
			{initial.status === "scheduled" ? (
				<p className="flex items-start gap-2 rounded-lg border border-[#90B4CC] bg-secondary/50 p-3 text-sm">
					<CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
					Editing moves this email back to drafts. Schedule it again when you are done.
				</p>
			) : null}

			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
				<div className="grid min-w-0 content-start gap-3">
					{!initial.id && templates.length > 0 && blocks.length === 0 ? (
						<div className="row-enter grid gap-2">
							<span className="text-sm text-muted-foreground">Start from a template</span>
							<div className="flex flex-wrap gap-2">
								{templates.slice(0, 6).map((t) => (
									<button key={t.id} type="button" onClick={() => applyTemplate(t)} className="rounded-full border border-border px-3 py-1.5 text-sm transition-colors hover:border-accent">
										{t.name}
									</button>
								))}
							</div>
						</div>
					) : null}

					<Step n={1} title="Sender and category" done={checks.sender} open={open === 1} onToggle={() => toggle(1)} summary={sender && category ? `${sender.displayName} · ${category.name}` : "Not set"}>
						<div className="grid gap-4 sm:grid-cols-2">
							<label className="grid gap-2 text-sm font-medium">
								Category
								<select value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value || null)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
									<option value="">Choose</option>
									{categories.map((c) => (
										<option key={c.id} value={c.id}>
											{c.name}
											{c.required ? " (required)" : ""}
										</option>
									))}
								</select>
								<span className="text-xs font-normal text-muted-foreground">
									{category ? (category.required ? "Every member in the audience gets this." : "Members who turned this off are skipped.") : "Every email needs a category."}
								</span>
							</label>
							<label className="grid gap-2 text-sm font-medium">
								From
								<select value={senderId ?? ""} onChange={(e) => setSenderId(e.target.value || null)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
									<option value="">Choose</option>
									{senders.map((s) => (
										<option key={s.id} value={s.id}>
											{s.displayName} ({s.address})
										</option>
									))}
								</select>
							</label>
						</div>
						{senders.length === 0 || categories.length === 0 ? (
							<p className="mt-3 text-sm text-muted-foreground">
								Add a sender and a category in{" "}
								<Link href="/portal/admin/email/settings" className="text-accent underline">
									Senders & categories
								</Link>{" "}
								first.
							</p>
						) : null}
					</Step>

					<Step n={2} title="Audience" done={checks.audience} open={open === 2} onToggle={() => toggle(2)} summary={`${audienceSummary}${preview ? ` · ${preview.willReceive} will receive` : ""}`}>
						<AudiencePicker value={audience} onChange={setAudience} options={options} memberLabels={memberLabels} categoryId={categoryId} categoryName={category?.name ?? null} onPreview={setPreview} />
					</Step>

					<Step n={3} title="Subject and preview text" done={checks.subject} open={open === 3} onToggle={() => toggle(3)} summary={subject || "No subject"}>
						<div className="grid gap-4">
							<TaggedField label="Subject" value={subject} onChange={setSubject} maxLength={200} placeholder="This week at CODE" />
							<TaggedField label="Preview text" value={preheader} onChange={setPreheader} maxLength={200} hint="Shown after the subject in most inboxes." />
						</div>
					</Step>

					<Step n={4} title="Content" done={checks.content} open={open === 4} onToggle={() => toggle(4)} summary={blocks.length ? `${blocks.length} blocks` : "Empty"}>
						<BlockEditor blocks={blocks} onChange={setBlocks} baseUrl={baseUrl} footer={footer} people={people} events={events} layout="compact" />
					</Step>

					<Step n={5} title="When" done open={open === 5} onToggle={() => toggle(5)} summary={whenLabel}>
						<fieldset className="grid gap-2">
							<legend className="sr-only">When to send</legend>
							{(["now", "at"] as const).map((mode) => (
								<label key={mode} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary/50">
									<input type="radio" name="timing" checked={timing === mode} onChange={() => setTiming(mode)} className="mt-1 accent-[#06192F]" />
									<span className="grid gap-2">
										<span className="font-medium">{mode === "now" ? "Send now" : "Schedule"}</span>
										{mode === "now" ? (
											<span className="text-sm text-muted-foreground">Starts in 2 minutes. You can undo until then.</span>
										) : (
											<input
												type="datetime-local"
												value={at}
												min={toLocalInput(new Date())}
												onChange={(e) => setAt(e.target.value)}
												disabled={timing !== "at"}
												className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
												aria-label="Send date and time, Manila time"
											/>
										)}
									</span>
								</label>
							))}
						</fieldset>
					</Step>
				</div>

				<aside className="hidden content-start gap-3 lg:sticky lg:top-6 lg:grid lg:self-start">
					<div className="grid gap-3 rounded-xl border border-border bg-card p-4">
						<dl className="grid gap-2 text-sm">
							{[
								["From", sender ? sender.displayName : "Not set"],
								["To", preview ? `${preview.willReceive} members` : "No one yet"],
								["Category", category ? `${category.name}${category.required ? " (required)" : ""}` : "Not set"],
								["When", timing === "now" ? "Now" : MANILA.format(new Date(`${at}:00+08:00`))],
							].map(([term, detail]) => (
								<div key={term} className="flex min-w-0 justify-between gap-3">
									<dt className="text-muted-foreground">{term}</dt>
									<dd className="min-w-0 truncate text-right font-medium">{detail}</dd>
								</div>
							))}
						</dl>
						<Button variant="outline" onClick={testSend} disabled={pending || !checks.content}>
							<FlaskConical />
							Send me a test
						</Button>
						<Button onClick={() => dialogRef.current?.showModal()} disabled={!ready || pending}>
							<Send />
							Review and send
						</Button>
						{!ready ? <p className="text-xs text-muted-foreground">Finish the steps with an empty circle to send.</p> : null}
					</div>
				</aside>
			</div>

			<div className="fixed inset-x-0 bottom-20 z-30 flex items-center gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
				<span className="min-w-0 flex-1 truncate text-sm">
					<span className="font-semibold tabular-nums">{preview?.willReceive ?? 0}</span> will receive
				</span>
				<Button variant="outline" size="sm" onClick={testSend} disabled={pending || !checks.content}>
					Test
				</Button>
				<Button size="sm" onClick={() => dialogRef.current?.showModal()} disabled={!ready || pending}>
					Review
				</Button>
			</div>

			<dialog ref={dialogRef} className="email-dialog m-auto w-[min(92vw,30rem)] rounded-xl border border-border bg-card p-0 text-card-foreground shadow-xl">
				<div className="grid gap-4 p-5">
					<h2 className="font-heading text-2xl">Send this email?</h2>
					<dl className="grid gap-2 text-sm">
						{[
							["From", sender ? `${sender.displayName} <${sender.address}>` : ""],
							["Category", category ? `${category.name} (${category.required ? "required, reaches everyone" : "optional"})` : ""],
							["To", audienceSummary],
							["Recipients", `${preview?.willReceive ?? 0}${preview?.optedOut.length ? ` (${preview.optedOut.length} opted out are skipped)` : ""}`],
							["Subject", subject],
							["When", whenLabel],
						].map(([term, detail]) => (
							<div key={term} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
								<dt className="text-muted-foreground">{term}</dt>
								<dd className="min-w-0 break-all sm:break-words">{detail}</dd>
							</div>
						))}
					</dl>
					<div className="flex flex-wrap justify-end gap-2">
						<Button variant="ghost" onClick={() => dialogRef.current?.close()} disabled={pending || sent}>
							Keep editing
						</Button>
						<Button onClick={confirm} disabled={pending || sent} className="min-w-44 transition-[background-color,min-width] duration-200">
							{sent ? <Check className="check-pop" /> : <Send />}
							{sent ? (timing === "now" ? "Queued" : "Scheduled") : primaryLabel}
						</Button>
					</div>
				</div>
			</dialog>
		</div>
	);
}
```

- [ ] **Step 4: New and edit pages**

`src/app/portal/admin/email/new/page.tsx`:

```tsx
import { getRepositories } from "@/db";
import { EMPTY_AUDIENCE } from "@/lib/email/types";
import { requireActor } from "@/server/auth/actor";
import { Composer } from "../composer";
import { loadComposerData } from "../composer-data";

export const dynamic = "force-dynamic";

export default async function NewEmailPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
	const actor = await requireActor();
	const { template: templateId } = await searchParams;
	const { email } = await getRepositories();
	const template = templateId ? await email.templates.get(actor, templateId) : null;
	const data = await loadComposerData(actor, null);
	return (
		<Composer
			{...data}
			initial={{
				id: null,
				templateId: template?.id ?? null,
				categoryId: template?.categoryId ?? null,
				senderId: null,
				subject: template?.subject ?? "",
				preheader: template?.preheader ?? "",
				blocks: template?.blocks ?? [],
				audience: EMPTY_AUDIENCE,
				status: "draft",
			}}
		/>
	);
}
```

`src/app/portal/admin/email/sends/[id]/edit/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { Composer } from "../../../composer";
import { loadComposerData } from "../../../composer-data";

export const dynamic = "force-dynamic";

export default async function EditEmailPage({ params }: { params: Promise<{ id: string }> }) {
	const actor = await requireActor();
	const { id } = await params;
	const { email } = await getRepositories();
	const campaign = await email.campaigns.get(actor, id);
	if (!campaign) notFound();
	if (campaign.status !== "draft" && campaign.status !== "scheduled") redirect(`/portal/admin/email/sends/${id}`);
	const data = await loadComposerData(actor, campaign.audience);
	return (
		<Composer
			{...data}
			initial={{
				id: campaign.id,
				templateId: campaign.templateId,
				categoryId: campaign.categoryId,
				senderId: campaign.senderId,
				subject: campaign.subject,
				preheader: campaign.preheader,
				blocks: campaign.blocks,
				audience: campaign.audience,
				status: campaign.status,
			}}
		/>
	);
}
```

The composer is a new route under `/portal/admin/email/new`; the "New email" nav page from Task 13 points at it.

- [ ] **Step 5: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add src/components/email/audience-picker.tsx src/app/portal/admin/email/composer.tsx src/app/portal/admin/email/composer-data.ts src/app/portal/admin/email/new src/app/portal/admin/email/sends
git commit -m "feat(email): add audience picker and checklist composer with review dialog"
```

---

### Task 17: Send report

**Files:**
- Create: `src/app/portal/admin/email/sends/[id]/page.tsx`
- Create: `src/app/portal/admin/email/sends/[id]/report-actions.tsx`

**Interfaces:**
- Consumes: `email.campaigns.report` (Task 8); `StatusPill`, `SendProgress`, `EmailPreview` (Task 13); `unscheduleCampaignAction`, `cancelCampaignAction`, `retryFailedAction`, `duplicateCampaignAction` (Task 13); `formatManila` (Task 14); `renderEmail`, `valueResolver`, `SAMPLE_MERGE_VALUES`.
- Produces: the `/portal/admin/email/sends/[id]` page. `ReportActions({ id, status, failed, scheduledAt })`.

- [ ] **Step 1: Report actions (client)**

`src/app/portal/admin/email/sends/[id]/report-actions.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Copy, PenLine, RotateCcw, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { EmailCampaignStatus } from "@/lib/email/types";
import { cancelCampaignAction, duplicateCampaignAction, retryFailedAction, unscheduleCampaignAction } from "../../actions";

function useCountdown(target: Date | null) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!target) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [target]);
	if (!target) return null;
	const left = Math.max(0, Math.round((target.getTime() - now) / 1000));
	return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

export function ReportActions({ id, status, failed, scheduledAt }: { id: string; status: EmailCampaignStatus; failed: number; scheduledAt: Date | null }) {
	const router = useRouter();
	const toast = useToast();
	const [pending, startTransition] = useTransition();
	const soon = status === "scheduled" && scheduledAt && scheduledAt.getTime() - Date.now() < 5 * 60_000 ? scheduledAt : null;
	const countdown = useCountdown(soon);

	const run = (task: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, message: string, then?: (data: unknown) => void) =>
		startTransition(async () => {
			const result = await task();
			if (!result.ok) return toast({ message: result.error });
			toast({ message });
			if (then) then(result.data);
			else router.refresh();
		});

	return (
		<div className="flex flex-wrap items-center gap-2">
			{status === "scheduled" ? (
				<>
					{countdown ? (
						<span className="rounded-full bg-secondary px-3 py-1 text-sm tabular-nums" aria-live="polite">
							Sending in {countdown}
						</span>
					) : null}
					<Button variant={countdown ? "default" : "outline"} disabled={pending} onClick={() => run(() => unscheduleCampaignAction(id), "Moved back to drafts.", () => router.push(`/portal/admin/email/sends/${id}/edit`))}>
						<Undo2 />
						{countdown ? "Undo" : "Unschedule"}
					</Button>
					<Button asChild variant="ghost">
						<Link href={`/portal/admin/email/sends/${id}/edit`}>
							<PenLine />
							Edit
						</Link>
					</Button>
				</>
			) : null}
			{status === "sending" ? (
				<Button
					variant="outline"
					disabled={pending}
					onClick={() => {
						if (window.confirm("Stop sending? Members who already got it keep it.")) run(() => cancelCampaignAction(id), "Sending stopped.");
					}}
				>
					<X />
					Stop sending
				</Button>
			) : null}
			{(status === "sent" || status === "failed") && failed > 0 ? (
				<Button variant="outline" disabled={pending} onClick={() => run(() => retryFailedAction(id), "Retrying failed recipients.")}>
					<RotateCcw />
					Retry {failed} failed
				</Button>
			) : null}
			<Button
				variant="ghost"
				disabled={pending}
				onClick={() => run(() => duplicateCampaignAction(id), "Copied to a new draft.", (newId) => router.push(`/portal/admin/email/sends/${String(newId)}/edit`))}
			>
				<Copy />
				Duplicate
			</Button>
		</div>
	);
}
```

- [ ] **Step 2: Report page**

`src/app/portal/admin/email/sends/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import { getRepositories } from "@/db";
import { EmailPreview } from "@/components/email/email-preview";
import { SendProgress } from "@/components/email/send-progress";
import { StatusPill } from "@/components/email/status-pill";
import { Input } from "@/components/ui/input";
import { SAMPLE_MERGE_VALUES } from "@/lib/email/merge";
import { renderEmail, valueResolver } from "@/lib/email/render";
import type { EmailDeliveryStatus } from "@/lib/email/types";
import { cn } from "@/lib/utils";
import { requireActor } from "@/server/auth/actor";
import { emailConfigFromEnv } from "@/server/email/db";
import { formatManila } from "../../campaign-row";
import { ReportActions } from "./report-actions";

export const dynamic = "force-dynamic";

const STRIP: { status: EmailDeliveryStatus; label: string }[] = [
	{ status: "pending", label: "Queued" },
	{ status: "sent", label: "Sent" },
	{ status: "failed", label: "Failed" },
	{ status: "skipped_optout", label: "Opted out" },
];
const STATUSES = new Set<string>(["pending", "sent", "failed", "skipped_optout", "cancelled"]);

export default async function SendReportPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ status?: string; q?: string; tab?: string }>;
}) {
	const actor = await requireActor();
	const { id } = await params;
	const { status: rawStatus, q = "", tab = "recipients" } = await searchParams;
	const status = rawStatus && STATUSES.has(rawStatus) ? (rawStatus as EmailDeliveryStatus) : undefined;
	const { email } = await getRepositories();
	const report = await email.campaigns.report(actor, id, { status, q });
	if (!report) notFound();
	const { campaign, counts, deliveries } = report;
	const total = Object.values(counts).reduce((a, b) => a + b, 0);
	const href = (params: Record<string, string | undefined>) => {
		const search = new URLSearchParams(Object.entries({ status, q, tab, ...params }).filter((e): e is [string, string] => Boolean(e[1])));
		return `/portal/admin/email/sends/${id}${search.size ? `?${search}` : ""}`;
	};
	const { publicBaseUrl } = emailConfigFromEnv();
	const preview =
		tab === "content"
			? renderEmail({
					subject: campaign.subject,
					preheader: campaign.preheader,
					blocks: campaign.blocks,
					resolve: valueResolver(SAMPLE_MERGE_VALUES),
					values: SAMPLE_MERGE_VALUES,
					baseUrl: publicBaseUrl,
					footer: { categoryName: campaign.categoryName ?? "CODE", required: true, archiveUrl: null, preferencesUrl: "#", unsubscribeUrl: null },
				})
			: null;

	return (
		<div className="grid gap-6">
			<Link href="/portal/admin/email" className="inline-flex items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground">
				<ArrowLeft className="size-4" aria-hidden />
				Email
			</Link>

			<header className="grid gap-3">
				<div className="flex min-w-0 flex-wrap items-center gap-3">
					<h1 className="min-w-0 break-all font-heading text-3xl sm:break-words">{campaign.subject || "Untitled email"}</h1>
					<StatusPill status={campaign.status} />
				</div>
				<p className="text-sm text-muted-foreground">
					From {campaign.senderName ?? "no sender"} · {campaign.categoryName ?? "no category"}
					{campaign.scheduledAt ? ` · ${campaign.status === "scheduled" ? "Sends" : "Started"} ${formatManila(campaign.startedAt ?? campaign.scheduledAt)}` : ""}
					{campaign.finishedAt ? ` · Finished ${formatManila(campaign.finishedAt)}` : ""}
				</p>
				<ReportActions id={campaign.id} status={campaign.status} failed={counts.failed} scheduledAt={campaign.scheduledAt} />
			</header>

			<section className="grid gap-4 rounded-xl border border-border bg-card p-4">
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
					{STRIP.map((item) => (
						<Link
							key={item.status}
							href={href({ status: status === item.status ? undefined : item.status, tab: "recipients" })}
							aria-current={status === item.status ? "true" : undefined}
							className={cn(
								"grid gap-0.5 rounded-lg border border-border p-3 transition-colors hover:border-accent",
								status === item.status && "border-primary bg-secondary/60",
							)}
						>
							<span className="text-sm text-muted-foreground">{item.label}</span>
							<span className="font-heading text-2xl tabular-nums">{counts[item.status]}</span>
						</Link>
					))}
				</div>
				<SendProgress
					status={campaign.status}
					total={total}
					sent={counts.sent}
					failed={counts.failed}
					skipped={counts.skipped_optout}
					scheduledAt={campaign.scheduledAt}
				/>
			</section>

			<nav className="flex gap-1 border-b border-border" aria-label="Report sections">
				{[
					["recipients", "Recipients"],
					["content", "Content"],
				].map(([value, label]) => (
					<Link
						key={value}
						href={href({ tab: value })}
						aria-current={tab === value ? "page" : undefined}
						className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground"
					>
						{label}
					</Link>
				))}
			</nav>

			{tab === "content" && preview ? (
				<EmailPreview bodyHtml={preview.bodyHtml} />
			) : (
				<section className="grid gap-3">
					<form className="relative w-full sm:w-72">
						<Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
						{status ? <input type="hidden" name="status" value={status} /> : null}
						<Input name="q" defaultValue={q} placeholder="Search recipients" aria-label="Search recipients" className="pl-8" />
					</form>
					{deliveries.length === 0 ? (
						<p className="text-sm text-muted-foreground">{campaign.status === "draft" || campaign.status === "scheduled" ? "Recipients are listed once sending starts." : "No recipients match."}</p>
					) : (
						<ul className="grid divide-y divide-border rounded-xl border border-border bg-card">
							{deliveries.map((d) => (
								<li key={d.id} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3">
									<div className="grid min-w-0 flex-1">
										<span className="min-w-0 break-all font-medium sm:break-words">{d.name}</span>
										<span className="min-w-0 break-all text-sm text-muted-foreground">{d.email}</span>
										{d.error ? <span className="min-w-0 break-all text-sm text-[#343B41] dark:text-[#D7DFE9]">{d.error}</span> : null}
									</div>
									<span className="text-sm tabular-nums text-muted-foreground">{d.sentAt ? formatManila(d.sentAt) : d.attempts ? `${d.attempts} tries` : ""}</span>
									<StatusPill status={d.status} />
								</li>
							))}
						</ul>
					)}
				</section>
			)}
		</div>
	);
}
```

- [ ] **Step 3: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add "src/app/portal/admin/email/sends/[id]/page.tsx" "src/app/portal/admin/email/sends/[id]/report-actions.tsx"
git commit -m "feat(email): add send report with live progress, filters, undo, and retry"
```

---

### Task 18: Replies inbox

**Files:**
- Create: `src/app/portal/admin/email/inbox/inbox-view.tsx`
- Create: `src/app/portal/admin/email/inbox/thread-controls.tsx`
- Create: `src/app/portal/admin/email/inbox/page.tsx`
- Create: `src/app/portal/admin/email/inbox/[threadId]/page.tsx`

**Interfaces:**
- Consumes: `email.inbox.list`, `get`, `listAssignees` (Task 10); `replyThreadAction`, `setThreadStatusAction`, `assignThreadAction` (Task 13); `formatManila` (Task 14).
- Produces: `InboxView({ folder, filter, threads, view, assignees })`, `ThreadControls`, `ReplyBox`, `MessageBody`.

- [ ] **Step 1: Client controls**

`src/app/portal/admin/email/inbox/thread-controls.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, CornerUpLeft, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { assignThreadAction, replyThreadAction, setThreadStatusAction } from "../actions";

export function ThreadControls({
	threadId,
	status,
	assigneeId,
	assignees,
	backHref,
}: {
	threadId: string;
	status: "open" | "done";
	assigneeId: string | null;
	assignees: { id: string; name: string }[];
	backHref: string;
}) {
	const router = useRouter();
	const toast = useToast();
	const [pending, startTransition] = useTransition();
	const setStatus = (next: "open" | "done") =>
		startTransition(async () => {
			const result = await setThreadStatusAction(threadId, next);
			if (!result.ok) return toast({ message: result.error });
			toast({
				message: next === "done" ? "Marked done." : "Moved back to open.",
				action: { label: "Undo", onClick: () => startTransition(async () => { await setThreadStatusAction(threadId, next === "done" ? "open" : "done"); router.refresh(); }) },
			});
			if (next === "done") router.push(backHref);
			else router.refresh();
		});

	return (
		<div className="flex flex-wrap items-center gap-2">
			<select
				aria-label="Assignee"
				defaultValue={assigneeId ?? ""}
				disabled={pending}
				onChange={(e) =>
					startTransition(async () => {
						const result = await assignThreadAction(threadId, e.target.value || null);
						toast({ message: result.ok ? "Assignment saved." : result.error });
						router.refresh();
					})
				}
				className="h-8 rounded-md border border-input bg-background px-2 text-sm"
			>
				<option value="">Unassigned</option>
				{assignees.map((a) => (
					<option key={a.id} value={a.id}>
						{a.name}
					</option>
				))}
			</select>
			{status === "open" ? (
				<Button size="sm" disabled={pending} onClick={() => setStatus("done")}>
					<Check />
					Done
				</Button>
			) : (
				<Button size="sm" variant="outline" disabled={pending} onClick={() => setStatus("open")}>
					<RotateCcw />
					Reopen
				</Button>
			)}
		</div>
	);
}

export function ReplyBox({ threadId, to }: { threadId: string; to: string }) {
	const router = useRouter();
	const toast = useToast();
	const [body, setBody] = useState("");
	const [pending, startTransition] = useTransition();
	return (
		<form
			className="grid gap-2 rounded-xl border border-border bg-card p-3"
			onSubmit={(e) => {
				e.preventDefault();
				startTransition(async () => {
					const result = await replyThreadAction(threadId, body);
					if (!result.ok) return toast({ message: result.error });
					setBody("");
					toast({ message: `Reply sent to ${to}.` });
					router.refresh();
				});
			}}
		>
			<label htmlFor={`reply-${threadId}`} className="text-sm font-medium">
				Reply to <span className="break-all">{to}</span>
			</label>
			<Textarea id={`reply-${threadId}`} value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={20_000} placeholder="Write a reply" />
			<Button type="submit" disabled={pending || !body.trim()} className="justify-self-end">
				<CornerUpLeft />
				{pending ? "Sending..." : "Send reply"}
			</Button>
		</form>
	);
}

/** Inbound HTML is sanitized on store and shown in a sandbox with no scripts; plain text is the default view. */
export function MessageBody({ text, html }: { text: string | null; html: string | null }) {
	const [formatted, setFormatted] = useState(!text && Boolean(html));
	return (
		<div className="grid gap-2">
			{formatted && html ? (
				<iframe title="Formatted message" sandbox="" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">${html}`} className="h-80 w-full rounded-lg border border-border bg-white" />
			) : (
				<p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text?.trim() || "(empty message)"}</p>
			)}
			{text && html ? (
				<button type="button" onClick={() => setFormatted((f) => !f)} className="justify-self-start text-xs text-accent underline-offset-2 hover:underline">
					{formatted ? "Show plain text" : "Show formatted"}
				</button>
			) : null}
		</div>
	);
}
```

- [ ] **Step 2: Inbox view (server)**

`src/app/portal/admin/email/inbox/inbox-view.tsx`:

```tsx
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import type { ThreadListItem, ThreadView } from "@/db/repositories/email-inbox";
import { cn } from "@/lib/utils";
import { formatManila } from "../campaign-row";
import { MessageBody, ReplyBox, ThreadControls } from "./thread-controls";

type Folder = "open" | "done";
type Filter = "all" | "mine" | "unassigned";

export function InboxView({
	folder,
	filter,
	threads,
	view,
	assignees,
}: {
	folder: Folder;
	filter: Filter;
	threads: ThreadListItem[];
	view: ThreadView | null;
	assignees: { id: string; name: string }[];
}) {
	const query = `?folder=${folder}&filter=${filter}`;
	const listHref = `/portal/admin/email/inbox${query}`;

	return (
		<div className="grid gap-4">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="font-heading text-3xl">Replies</h1>
					<p className="text-sm text-muted-foreground">Replies to CODE emails land here. Members see your answer from the same sender.</p>
				</div>
			</header>
			<div className="grid min-h-[60dvh] overflow-hidden rounded-xl border border-border bg-card md:grid-cols-[340px_minmax(0,1fr)]">
				<div className={cn("grid content-start border-border md:border-r", view && "max-md:hidden")}>
					<div className="flex flex-wrap gap-1 border-b border-border p-2">
						{(["open", "done"] as const).map((f) => (
							<Link key={f} href={`/portal/admin/email/inbox?folder=${f}&filter=${filter}`} aria-current={folder === f ? "page" : undefined} className="rounded-md px-2.5 py-1 text-sm capitalize transition-colors aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground hover:bg-secondary">
								{f}
							</Link>
						))}
						<span className="mx-1 w-px bg-border" aria-hidden />
						{(["all", "mine", "unassigned"] as const).map((f) => (
							<Link key={f} href={`/portal/admin/email/inbox?folder=${folder}&filter=${f}`} aria-current={filter === f ? "page" : undefined} className="rounded-md px-2.5 py-1 text-sm capitalize transition-colors aria-[current=page]:bg-secondary aria-[current=page]:font-medium hover:bg-secondary">
								{f}
							</Link>
						))}
					</div>
					{threads.length === 0 ? (
						<div className="grid place-items-center gap-2 p-10 text-center text-sm text-muted-foreground">
							<Mail className="size-6" aria-hidden />
							{folder === "open" ? "No open replies. You're caught up." : "Nothing marked done yet."}
						</div>
					) : (
						<ul className="grid divide-y divide-border">
							{threads.map((t, i) => (
								<li key={t.id} className="row-enter" style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}>
									<Link
										href={`/portal/admin/email/inbox/${t.id}${query}`}
										aria-current={view?.thread.id === t.id ? "page" : undefined}
										className="grid gap-0.5 px-4 py-3 transition-colors hover:bg-secondary/60 aria-[current=page]:bg-secondary"
									>
										<span className="flex min-w-0 items-center gap-2">
											{t.unread ? <span className="size-2 shrink-0 rounded-full bg-[#4986AC]" aria-label="Unread" /> : null}
											<span className={cn("min-w-0 flex-1 truncate", t.unread ? "font-semibold" : "font-medium")}>{t.memberName ?? t.fromName ?? t.fromEmail}</span>
											<span className="shrink-0 text-xs text-muted-foreground">{formatManila(t.lastMessageAt)}</span>
										</span>
										<span className="min-w-0 truncate text-sm">{t.subject}</span>
										<span className="flex min-w-0 gap-2 text-xs text-muted-foreground">
											{t.campaignSubject ? <span className="min-w-0 truncate rounded bg-secondary px-1.5">Re: {t.campaignSubject}</span> : null}
											{t.isAuto ? <span className="shrink-0">Auto-reply</span> : null}
											{t.assigneeName ? <span className="shrink-0">· {t.assigneeName}</span> : null}
										</span>
									</Link>
								</li>
							))}
						</ul>
					)}
				</div>

				<div className={cn("grid content-start gap-4 p-4", !view && "max-md:hidden")}>
					{view ? (
						<>
							<Link href={listHref} className="inline-flex items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground md:hidden">
								<ArrowLeft className="size-4" aria-hidden />
								Replies
							</Link>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="grid min-w-0 gap-1">
									<h2 className="min-w-0 break-all font-heading text-2xl sm:break-words">{view.thread.subject}</h2>
									<p className="min-w-0 break-all text-sm text-muted-foreground">
										{view.thread.memberName ? `${view.thread.memberName} · ` : ""}
										{view.thread.fromEmail}
										{view.thread.memberName ? "" : " · not a member"}
									</p>
									{view.thread.campaignId ? (
										<Link href={`/portal/admin/email/sends/${view.thread.campaignId}`} className="justify-self-start rounded bg-secondary px-2 py-0.5 text-xs transition-colors hover:bg-secondary/70">
											Re: {view.thread.campaignSubject}
										</Link>
									) : null}
								</div>
								<ThreadControls threadId={view.thread.id} status={view.thread.status} assigneeId={view.thread.assigneeId} assignees={assignees} backHref={listHref} />
							</div>
							<ol className="grid gap-3">
								{view.messages.map((m) => (
									<li key={m.id} className={cn("row-enter grid gap-2 rounded-xl border p-4", m.direction === "out" ? "border-[#90B4CC] bg-secondary/40 md:ml-10" : "border-border")}>
										<div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
											<span className="min-w-0 break-all">{m.direction === "out" ? `You replied as ${m.fromEmail}` : m.fromEmail}</span>
											<span>{formatManila(m.createdAt)}</span>
										</div>
										<MessageBody text={m.text} html={m.direction === "in" ? m.html : null} />
									</li>
								))}
							</ol>
							<ReplyBox threadId={view.thread.id} to={view.thread.fromEmail} />
						</>
					) : (
						<div className="grid h-full place-items-center p-10 text-sm text-muted-foreground">Select a reply to read it.</div>
					)}
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Pages**

`src/app/portal/admin/email/inbox/page.tsx`:

```tsx
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { InboxView } from "./inbox-view";

export const dynamic = "force-dynamic";

export function parseInboxParams(params: { folder?: string; filter?: string }) {
	const folder = params.folder === "done" ? "done" : "open";
	const filter = params.filter === "mine" || params.filter === "unassigned" ? params.filter : "all";
	return { folder, filter } as const;
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ folder?: string; filter?: string }> }) {
	const actor = await requireActor();
	const { folder, filter } = parseInboxParams(await searchParams);
	const { email } = await getRepositories();
	const [threads, assignees] = await Promise.all([email.inbox.list(actor, { folder, filter }), email.inbox.listAssignees(actor)]);
	return <InboxView folder={folder} filter={filter} threads={threads} view={null} assignees={assignees} />;
}
```

`src/app/portal/admin/email/inbox/[threadId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { InboxView } from "../inbox-view";
import { parseInboxParams } from "../page";

export const dynamic = "force-dynamic";

export default async function ThreadPage({
	params,
	searchParams,
}: {
	params: Promise<{ threadId: string }>;
	searchParams: Promise<{ folder?: string; filter?: string }>;
}) {
	const actor = await requireActor();
	const { threadId } = await params;
	const { folder, filter } = parseInboxParams(await searchParams);
	const { email } = await getRepositories();
	const view = await email.inbox.get(actor, threadId);
	if (!view) notFound();
	const [threads, assignees] = await Promise.all([email.inbox.list(actor, { folder, filter }), email.inbox.listAssignees(actor)]);
	return <InboxView folder={folder} filter={filter} threads={threads} view={view} assignees={assignees} />;
}
```

Next forbids non-route exports from `page.tsx` in some versions. If the build rejects `export function parseInboxParams` in `page.tsx`, move it to `src/app/portal/admin/email/inbox/params.ts` and import it from both pages.

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add src/app/portal/admin/email/inbox
git commit -m "feat(email): add threaded replies inbox with assign, done, and reply"
```

---

### Task 19: Member mail, preferences, and public unsubscribe

**Files:**
- Modify: `src/db/repositories/email-member.ts` (add `describeTokenCategory`)
- Modify: `src/db/repositories/email-member.integration.test.ts` (add a test)
- Create: `src/app/portal/mail/layout.tsx`
- Create: `src/app/portal/mail/page.tsx`
- Create: `src/app/portal/mail/[id]/page.tsx`
- Create: `src/app/portal/mail/preferences/page.tsx`
- Create: `src/app/portal/mail/preferences/preferences-list.tsx`
- Create: `src/app/portal/mail/actions.ts`
- Create: `src/app/unsubscribe/page.tsx`
- Create: `src/app/unsubscribe/unsubscribe-card.tsx`
- Create: `src/app/unsubscribe/actions.ts`
- Create: `src/app/api/email/unsubscribe/route.ts`

**Interfaces:**
- Consumes: `email.member.*`, `applyTokenOptOut` (Task 11); `verifyUnsubscribeToken` (Task 5); `emailDbFromEnv`, `emailConfigFromEnv` (Task 13); `EmailPreview` (Task 13).
- Produces: `describeTokenCategory(db, payload): Promise<{ categoryName: string; requiredNames: string[]; optedOut: boolean } | null>`, `setOptOutAction(categoryId, optedOut)`, `unsubscribeAction(token, optedOut)`.

- [ ] **Step 1: Write the failing test for `describeTokenCategory`**

Append inside the `describe("email member side", ...)` block of `src/db/repositories/email-member.integration.test.ts`, and add `describeTokenCategory` to the import from `./email-member`:

```ts
	it("describes a token without writing", async () => {
		expect(await describeTokenCategory(db, { memberId: "mem_a", categoryId: "ecat_opt" })).toEqual({ categoryName: "Newsletter", requiredNames: ["Memos"], optedOut: false });
		expect(await describeTokenCategory(db, { memberId: "mem_a", categoryId: "ecat_req" })).toBeNull();
		expect(await db.select().from(emailOptouts)).toHaveLength(0);
	});
```

Run: `pnpm exec vitest run src/db/repositories/email-member.integration.test.ts`
Expected: FAIL, `describeTokenCategory` is not exported.

- [ ] **Step 2: Implement it**

In `src/db/repositories/email-member.ts`, add a helper and the function, and use the helper inside `applyTokenOptOut` in place of its inline `required` query:

```ts
async function requiredCategoryNames(db: EmailDb): Promise<string[]> {
	const rows = await db
		.select({ name: emailCategories.name })
		.from(emailCategories)
		.where(and(eq(emailCategories.required, true), isNull(emailCategories.archivedAt)))
		.orderBy(asc(emailCategories.sortOrder));
	return rows.map((r) => r.name);
}

/** Read-only lookup for the unsubscribe page. GET requests never write, because link scanners prefetch them. */
export async function describeTokenCategory(
	db: EmailDb,
	payload: { memberId: string; categoryId: string },
): Promise<{ categoryName: string; requiredNames: string[]; optedOut: boolean } | null> {
	const category = await activeCategory(db, payload.categoryId);
	if (!category || category.required) return null;
	const [member] = await db.select({ id: members.id }).from(members).where(eq(members.id, payload.memberId)).limit(1);
	if (!member) return null;
	const [optout] = await db
		.select({ memberId: emailOptouts.memberId })
		.from(emailOptouts)
		.where(and(eq(emailOptouts.memberId, payload.memberId), eq(emailOptouts.categoryId, payload.categoryId)))
		.limit(1);
	return { categoryName: category.name, requiredNames: await requiredCategoryNames(db), optedOut: Boolean(optout) };
}
```

Run: `pnpm exec vitest run src/db/repositories/email-member.integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Member actions and layout**

`src/app/portal/mail/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { runAction } from "@/lib/email/action-result";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";

export async function setOptOutAction(categoryId: string, optedOut: boolean) {
	return runAction(async () => {
		assertFeatureEnabled("email");
		const actor = await requireActor();
		const { email } = await getRepositories();
		await email.member.setOptOut(actor, z.string().min(1).max(64).parse(categoryId), z.boolean().parse(optedOut));
		revalidatePath("/portal/mail/preferences");
		return null;
	});
}
```

`src/app/portal/mail/layout.tsx`:

```tsx
import { notFound } from "next/navigation";
import { ToastProvider } from "@/components/ui/toast";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";

export default function MailLayout({ children }: { children: React.ReactNode }) {
	if (!isFeatureEnabled("email")) notFound();
	return <ToastProvider>{children}</ToastProvider>;
}
```

- [ ] **Step 4: Archive and reader**

`src/app/portal/mail/page.tsx`:

```tsx
import Link from "next/link";
import { Inbox, Settings2 } from "lucide-react";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";

export const dynamic = "force-dynamic";
const DATE = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });

export default async function MailPage() {
	const actor = await requireActor();
	const { email } = await getRepositories();
	const items = await email.member.listArchive(actor);
	return (
		<div className="grid gap-5">
			<header className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="font-heading text-3xl">Mail</h1>
					<p className="text-sm text-muted-foreground">Every CODE email sent to you, in one place.</p>
				</div>
				<Link href="/portal/mail/preferences" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:border-accent">
					<Settings2 className="size-4" aria-hidden />
					Email preferences
				</Link>
			</header>
			{items.length === 0 ? (
				<div className="grid place-items-center gap-2 rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
					<Inbox className="size-6" aria-hidden />
					No CODE emails yet. They will appear here when officers send one.
				</div>
			) : (
				<ul className="grid divide-y divide-border rounded-xl border border-border bg-card">
					{items.map((item, i) => (
						<li key={item.deliveryId} className="row-enter" style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}>
							<Link href={`/portal/mail/${item.deliveryId}`} className="grid gap-1 px-4 py-3 transition-colors hover:bg-secondary/60">
								<span className="flex min-w-0 items-center gap-2">
									{item.readAt ? null : <span className="size-2 shrink-0 rounded-full bg-[#4986AC]" aria-label="Unread" />}
									<span className={item.readAt ? "min-w-0 flex-1 truncate font-medium" : "min-w-0 flex-1 truncate font-semibold"}>{item.subject}</span>
									<span className="shrink-0 text-xs text-muted-foreground">{item.sentAt ? DATE.format(item.sentAt) : ""}</span>
								</span>
								<span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
									{item.categoryName ? <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{item.categoryName}</span> : null}
									<span className="min-w-0 truncate">{item.preheader || item.senderName}</span>
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
```

`src/app/portal/mail/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getRepositories } from "@/db";
import { EmailPreview } from "@/components/email/email-preview";
import { requireActor } from "@/server/auth/actor";
import { emailConfigFromEnv } from "@/server/email/db";

export const dynamic = "force-dynamic";
const DATE = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

export default async function MailReaderPage({ params }: { params: Promise<{ id: string }> }) {
	const actor = await requireActor();
	const { id } = await params;
	const { email } = await getRepositories();
	const view = await email.member.getForReader(actor, id, emailConfigFromEnv().publicBaseUrl);
	if (!view) notFound();
	return (
		<article className="mx-auto grid w-full max-w-[720px] gap-4">
			<Link href="/portal/mail" className="inline-flex items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground">
				<ArrowLeft className="size-4" aria-hidden />
				Mail
			</Link>
			<header className="grid gap-1">
				<h1 className="min-w-0 break-words font-heading text-3xl">{view.subject}</h1>
				<p className="text-sm text-muted-foreground">
					{view.senderName ?? "CODE"} · {view.sentAt ? DATE.format(view.sentAt) : ""}
				</p>
			</header>
			<EmailPreview bodyHtml={view.bodyHtml} />
			<p className="text-sm text-muted-foreground">
				Sent to you because: {view.categoryName}.{" "}
				<Link href="/portal/mail/preferences" className="text-accent underline-offset-2 hover:underline">
					Manage
				</Link>
			</p>
		</article>
	);
}
```

- [ ] **Step 5: Preferences**

`src/app/portal/mail/preferences/page.tsx`:

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { PreferencesList } from "./preferences-list";

export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
	const actor = await requireActor();
	const { email } = await getRepositories();
	const rows = await email.member.listPreferences(actor);
	return (
		<div className="mx-auto grid w-full max-w-2xl gap-5">
			<Link href="/portal/mail" className="inline-flex items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground">
				<ArrowLeft className="size-4" aria-hidden />
				Mail
			</Link>
			<header>
				<h1 className="font-heading text-3xl">Email preferences</h1>
				<p className="text-sm text-muted-foreground">Choose which CODE emails reach your inbox. Changes save as you go.</p>
			</header>
			<PreferencesList rows={rows} />
		</div>
	);
}
```

`src/app/portal/mail/preferences/preferences-list.tsx`:

```tsx
"use client";

import { useOptimistic, useTransition } from "react";
import { Lock } from "lucide-react";
import type { PreferenceRow } from "@/db/repositories/email-member";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { setOptOutAction } from "../actions";

function Switch({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange?: (next: boolean) => void; label: string }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange?.(!checked)}
			className={cn(
				"relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed",
				checked ? "bg-primary" : "bg-[#AAAFB5]",
				disabled && "opacity-60",
			)}
		>
			<span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform duration-200 motion-reduce:transition-none", checked ? "translate-x-5" : "translate-x-0.5")} />
		</button>
	);
}

export function PreferencesList({ rows }: { rows: PreferenceRow[] }) {
	const toast = useToast();
	const [, startTransition] = useTransition();
	const [optimistic, setOptimistic] = useOptimistic(rows, (current, change: { id: string; optedOut: boolean }) =>
		current.map((r) => (r.id === change.id ? { ...r, optedOut: change.optedOut } : r)),
	);
	const required = optimistic.filter((r) => r.required);
	const optional = optimistic.filter((r) => !r.required);

	const toggle = (row: PreferenceRow, optedOut: boolean) =>
		startTransition(async () => {
			setOptimistic({ id: row.id, optedOut });
			const result = await setOptOutAction(row.id, optedOut);
			if (!result.ok) return toast({ message: result.error });
			toast({
				message: optedOut ? `${row.name} turned off.` : `${row.name} turned on.`,
				action: { label: "Undo", onClick: () => toggle(row, !optedOut) },
			});
		});

	if (optimistic.length === 0) return <p className="text-sm text-muted-foreground">There are no email categories yet.</p>;

	return (
		<div className="grid gap-5">
			{required.length > 0 ? (
				<section className="grid gap-2">
					<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Always sent to members</h2>
					<ul className="grid divide-y divide-border rounded-xl border border-border bg-card">
						{required.map((row) => (
							<li key={row.id} className="flex min-w-0 items-center gap-4 px-4 py-3">
								<div className="grid min-w-0 flex-1 gap-0.5">
									<span className="flex items-center gap-1.5 font-medium">
										<Lock className="size-3.5 text-muted-foreground" aria-hidden />
										{row.name}
									</span>
									<span className="text-sm text-muted-foreground">{row.description || "Official notices for members."} Required while you are a member.</span>
								</div>
								<Switch checked disabled label={`${row.name} is required`} />
							</li>
						))}
					</ul>
				</section>
			) : null}
			{optional.length > 0 ? (
				<section className="grid gap-2">
					<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">You choose</h2>
					<ul className="grid divide-y divide-border rounded-xl border border-border bg-card">
						{optional.map((row) => (
							<li key={row.id} className="flex min-w-0 items-center gap-4 px-4 py-3">
								<div className="grid min-w-0 flex-1 gap-0.5">
									<span className="min-w-0 break-all font-medium sm:break-words">{row.name}</span>
									{row.description ? <span className="text-sm text-muted-foreground">{row.description}</span> : null}
								</div>
								<Switch checked={!row.optedOut} onChange={(on) => toggle(row, !on)} label={row.name} />
							</li>
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}
```

- [ ] **Step 6: Public unsubscribe**

`src/app/unsubscribe/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { applyTokenOptOut } from "@/db/repositories/email-member";
import { runAction } from "@/lib/email/action-result";
import { emailConfigFromEnv, emailDbFromEnv } from "@/server/email/db";
import { verifyUnsubscribeToken } from "@/server/email/unsubscribe-token";
import { assertFeatureEnabled } from "@/server/features";

export async function unsubscribeAction(token: string, optedOut: boolean) {
	return runAction(async () => {
		assertFeatureEnabled("email");
		const payload = await verifyUnsubscribeToken(emailConfigFromEnv().unsubscribeSecret, z.string().max(400).parse(token));
		if (!payload) throw new Error("This link is not valid.");
		const result = await applyTokenOptOut(emailDbFromEnv(), payload, z.boolean().parse(optedOut));
		if (!result) throw new Error("This link no longer applies to an email you can turn off.");
		return result;
	});
}
```

`src/app/unsubscribe/unsubscribe-card.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { unsubscribeAction } from "./actions";

export function UnsubscribeCard({ token, categoryName, requiredNames, initiallyOut }: { token: string; categoryName: string; requiredNames: string[]; initiallyOut: boolean }) {
	const [out, setOut] = useState(initiallyOut);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const set = (next: boolean) =>
		startTransition(async () => {
			const result = await unsubscribeAction(token, next);
			if (!result.ok) return setError(result.error);
			setError(null);
			setOut(next);
		});

	return (
		<div className="toast-enter grid w-full max-w-[420px] gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
			<img src="/code-logo-full-navy.png" alt="CODE" className="h-8 w-auto justify-self-start dark:hidden" />
			<img src="/code-logo-full-white.png" alt="CODE" className="hidden h-8 w-auto justify-self-start dark:block" />
			{out ? (
				<>
					<div className="flex items-center gap-2">
						<span className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground">
							<Check className="check-pop size-4" aria-hidden />
						</span>
						<h1 className="font-heading text-2xl">You are unsubscribed from {categoryName}.</h1>
					</div>
					<Button variant="outline" onClick={() => set(false)} disabled={pending} className="justify-self-start">
						Undo
					</Button>
				</>
			) : (
				<>
					<h1 className="font-heading text-2xl">Stop getting {categoryName} emails?</h1>
					<Button onClick={() => set(true)} disabled={pending} className="justify-self-start">
						Unsubscribe from {categoryName}
					</Button>
				</>
			)}
			{error ? <p className="text-sm text-[#343B41] dark:text-[#D7DFE9]">{error}</p> : null}
			{requiredNames.length > 0 ? (
				<p className="text-sm text-muted-foreground">As a member you still get: {requiredNames.join(", ")}.</p>
			) : null}
			<Link href="/portal/mail/preferences" className="text-sm text-accent underline-offset-2 hover:underline">
				Manage all email preferences
			</Link>
		</div>
	);
}
```

`src/app/unsubscribe/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { describeTokenCategory } from "@/db/repositories/email-member";
import { emailConfigFromEnv, emailDbFromEnv } from "@/server/email/db";
import { verifyUnsubscribeToken } from "@/server/email/unsubscribe-token";
import { isFeatureEnabled } from "@/server/features";
import { UnsubscribeCard } from "./unsubscribe-card";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
	if (!isFeatureEnabled("email")) notFound();
	const { t = "" } = await searchParams;
	const payload = t ? await verifyUnsubscribeToken(emailConfigFromEnv().unsubscribeSecret, t) : null;
	const info = payload ? await describeTokenCategory(emailDbFromEnv(), payload) : null;
	return (
		<main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
			{info ? (
				<UnsubscribeCard token={t} categoryName={info.categoryName} requiredNames={info.requiredNames} initiallyOut={info.optedOut} />
			) : (
				<div className="grid w-full max-w-[420px] gap-3 rounded-2xl border border-border bg-card p-6">
					<h1 className="font-heading text-2xl">This link is not valid.</h1>
					<p className="text-sm text-muted-foreground">It may be old, or the email category no longer allows turning it off.</p>
					<Link href="/portal/mail/preferences" className="text-sm text-accent underline-offset-2 hover:underline">
						Sign in to manage email preferences
					</Link>
				</div>
			)}
		</main>
	);
}
```

`src/app/api/email/unsubscribe/route.ts`:

```ts
import { applyTokenOptOut } from "@/db/repositories/email-member";
import { emailConfigFromEnv, emailDbFromEnv } from "@/server/email/db";
import { verifyUnsubscribeToken } from "@/server/email/unsubscribe-token";
import { isFeatureEnabled } from "@/server/features";

// RFC 8058 one-click: mail providers POST here from their own servers, so there is no
// same-origin check. The HMAC token is the only credential and is scoped to one member
// and one optional category.
export async function POST(request: Request) {
	if (!isFeatureEnabled("email")) return new Response(null, { status: 404 });
	const token = new URL(request.url).searchParams.get("t") ?? "";
	const payload = await verifyUnsubscribeToken(emailConfigFromEnv().unsubscribeSecret, token);
	if (!payload) return new Response("Invalid link.", { status: 400 });
	await applyTokenOptOut(emailDbFromEnv(), payload, true);
	return new Response("Unsubscribed.", { status: 200 });
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	return Response.redirect(new URL(`/unsubscribe?t=${encodeURIComponent(url.searchParams.get("t") ?? "")}`, url.origin), 303);
}
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test:workers`
Expected: PASS.

```bash
git add src/db/repositories/email-member.ts src/db/repositories/email-member.integration.test.ts src/app/portal/mail src/app/unsubscribe src/app/api/email
git commit -m "feat(email): add member mail archive, preferences, and one-click unsubscribe"
```

---

### Task 20: Beta rollout

**Files:** none. Infrastructure only; every remote command needs the user's approval first.

- [ ] **Step 1: Full local verification**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. Then run `graphify update .`.

- [ ] **Step 2: User dashboard steps (ask the user, then wait)**

Ask the user to confirm each of these is done in the Cloudflare dashboard for account `83376df5e0bae067afa197b07430168d`:
1. Email Service: `ateneocode.org` onboarded as a sending domain (SPF, DKIM, and DMARC records added).
2. Email Routing enabled on `ateneocode.org`, with **Subaddressing** turned on in Email Routing settings.
3. Routing rule: `beta-inbox@ateneocode.org` set to **Send to a Worker**, Worker `code-nest-beta`. This rule can only be created after Step 5 deploys the `email` handler.
4. The list of From addresses they want. Update `allowed_sender_addresses` in `wrangler.beta.jsonc` to match and commit.

- [ ] **Step 3: Secret (show command, wait for approval)**

```bash
pnpm exec wrangler secret put EMAIL_UNSUBSCRIBE_SECRET --config wrangler.beta.jsonc
```

The user pastes a random value of at least 32 characters (for example from `openssl rand -base64 48`). Never echo it into the chat or a file.

- [ ] **Step 4: Migration (show command, wait for approval)**

Read-only check first:

```bash
pnpm exec wrangler d1 migrations list DB --config wrangler.beta.jsonc --remote
```

Expected: only `0007_*` pending. Then, after approval:

```bash
pnpm db:migrate:dev
```

- [ ] **Step 5: Deploy (show command, wait for approval)**

```bash
pnpm deploy:dev
```

Expected: the deploy output lists the `EMAIL` send-email binding and the `* * * * *` cron trigger.

- [ ] **Step 6: Grant the role and seed settings in the UI**

In `https://beta.ateneocode.org/portal/admin/members/roles`, grant **Email** to the first email admin. Then in `/portal/admin/email/settings` add:
- Senders that match the allowed list.
- Categories: Announcements (required), Memos (required), Newsletter (optional), Events (optional).

- [ ] **Step 7: Manual checks on beta (browser pane plus the user's phone)**

1. Home, settings, templates, composer, report, inbox, mail, preferences, and unsubscribe all render at 375 px and 1280 px, in light and dark mode, with no horizontal scroll (check with `resize_window`).
2. Build a template with every block type. Preview as a sample member and as yourself; toggle Desktop and Phone.
3. Send a test to yourself. Check it in Gmail on desktop and on a phone.
4. Send to a 2-3 person audience with an optional category. Watch the report count up. Check that Undo works inside the 2-minute window on a second send.
5. Reply from Gmail. The reply appears in Replies, threaded to the send, within a minute. Reply from the portal and confirm it arrives in Gmail in the same conversation.
6. Use Gmail's native Unsubscribe button. Preferences now show that category off. The footer link shows the confirm page and Undo works.
7. Check `pnpm exec wrangler tail code-nest-beta` output (read-only) for `email dispatch` log lines and no errors.

Record anything broken as a fix task before Task 21.

---

### Task 21: Beta polish loop for email screens

**Files:** the email UI files from Tasks 13-19 only.

- [ ] **Step 1: Critique**

Invoke the `impeccable` skill in critique mode against each live beta screen: home, composer (all five steps open), block editor, template library, report while sending, inbox, member mail, preferences, unsubscribe. Compare against the Mobbin references recorded in the spec (Resend composer, Mailchimp checklist, Klaviyo builder, HubSpot audience card, Front inbox, Luma report, Netflix and GetYourGuide locked preferences).

- [ ] **Step 2: Fix, verify, deploy, repeat**

For each material finding: fix it, run `pnpm typecheck && pnpm lint`, take a screenshot on beta after `pnpm deploy:dev` (show the command and wait for approval each time), and commit with a `fix(email): ...` message. Stop when a critique pass returns no material findings.

Portal-wide UI work outside the email screens belongs to Project B and gets its own spec.

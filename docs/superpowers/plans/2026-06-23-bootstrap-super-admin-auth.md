# Bootstrap Super Admin Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the active-term roster control member sign-in while one configured Google email bootstraps the first super admin.

**Architecture:** Keep Google profile validation in `access.ts`, roster authorization in `roster.ts`, and the one-time role assignment in a focused bootstrap helper. Auth.js composes those existing boundaries. No schema or migration changes are needed.

**Tech Stack:** Next.js, Auth.js, Drizzle ORM, Cloudflare D1, Vitest

## Global Constraints

- Use `AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL` for the exact normalized bootstrap identity.
- Remove `AUTH_ALLOWLIST_EMAILS`.
- Empty `AUTH_ALLOWED_DOMAINS` adds no domain restriction.
- Ordinary users still require the active-term roster.
- Role assignment must be idempotent.
- Do not add dependencies.

---

### Task 1: Google Identity Gate

**Files:**
- Modify: `src/server/auth/access.test.ts`
- Modify: `src/server/auth/access.ts`

**Interfaces:**
- Produces: `isGoogleSignInAllowed(profile, { allowedDomains }): boolean`

- [ ] **Step 1: Write failing tests**

Replace allowlist coverage with tests proving that an empty domain list allows any verified Google identity and a populated list rejects outside domains.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm test -- src/server/auth/access.test.ts`

Expected: FAIL because `AuthAccessPolicy` still requires `allowlistEmails` and empty domains reject the profile.

- [ ] **Step 3: Implement the minimum policy**

Remove `allowlistEmails`. Return true after provider and verification checks when `allowedDomains` is empty; otherwise require the normalized email domain to appear in the list.

- [ ] **Step 4: Verify the tests pass**

Run: `pnpm test -- src/server/auth/access.test.ts`

Expected: PASS.

### Task 2: Bootstrap Roster Bypass and Super Role

**Files:**
- Modify: `src/server/auth/roster.integration.test.ts`
- Modify: `src/server/auth/roster.ts`
- Create: `src/server/auth/bootstrap.ts`
- Create: `src/server/auth/bootstrap.integration.test.ts`

**Interfaces:**
- Produces: `isBootstrapEmail(email, configuredEmail): boolean`
- Produces: `grantBootstrapSuperRole(db, memberId, email, configuredEmail): Promise<void>`
- Changes: `isRosterSignInAllowed(db, email, now, bootstrapEmail?): Promise<boolean>`

- [ ] **Step 1: Write failing integration tests**

Add a roster test proving the configured bootstrap email bypasses the roster. Add bootstrap helper tests proving the matching member receives `role_super`, a nonmatching member does not, and repeated calls keep one assignment.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm test -- src/server/auth/roster.integration.test.ts src/server/auth/bootstrap.integration.test.ts`

Expected: FAIL because the bootstrap helper and roster argument do not exist.

- [ ] **Step 3: Implement the minimum bootstrap behavior**

Normalize both emails with `trim().toLowerCase()`. In the role helper, select the role whose key is `super`, then insert `{ memberId, roleId, assignedBy: memberId }` with `onConflictDoNothing()`.

- [ ] **Step 4: Verify the tests pass**

Run: `pnpm test -- src/server/auth/roster.integration.test.ts src/server/auth/bootstrap.integration.test.ts`

Expected: PASS.

### Task 3: Auth.js and Environment Wiring

**Files:**
- Modify: `src/auth.ts`
- Modify: `src/server/env.ts`
- Modify: `src/server/cloudflare.ts`
- Modify: `.env.example`
- Modify: `.env.local`
- Modify: `vitest.config.mts`

**Interfaces:**
- Consumes: `grantBootstrapSuperRole` and the extended `isRosterSignInAllowed`
- Adds: `AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL?: string`

- [ ] **Step 1: Wire Auth.js**

Pass the bootstrap email into the roster gate. In `createUser`, grant the bootstrap role before recording the existing self-provision audit event.

- [ ] **Step 2: Update environment declarations**

Add `AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL` and remove `AUTH_ALLOWLIST_EMAILS` from runtime schemas, Cloudflare types, logging, examples, and test bindings.

- [ ] **Step 3: Fill local values**

Set `AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL=charles.joshua.uy@student.ateneo.edu`, keep localhost auth URLs, and generate a cryptographically random `AUTH_SECRET`. Leave Google credentials and `SHARED_API_TOKEN` empty.

- [ ] **Step 4: Run auth tests**

Run: `pnpm test -- src/server/auth/access.test.ts src/server/auth/roster.integration.test.ts src/server/auth/bootstrap.integration.test.ts`

Expected: PASS.

### Task 4: Repository Verification

**Files:**
- Update generated graph files under `graphify-out/`

- [ ] **Step 1: Check removed configuration**

Run: `rg -n "AUTH_ALLOWLIST_EMAILS" . --glob "!graphify-out/**" --glob "!.git/**"`

Expected: no matches.

- [ ] **Step 2: Run the full checks**

Run: `pnpm test`, `pnpm lint`, and `pnpm build`.

Expected: all pass.

- [ ] **Step 3: Update the graph**

Run: `graphify update .`

Expected: successful incremental graph update.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only intended source, environment example, plan, and graph changes are present.

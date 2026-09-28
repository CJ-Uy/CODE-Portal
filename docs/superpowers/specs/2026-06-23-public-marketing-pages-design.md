# Public marketing pages — design

Date: 2026-06-23 (revised: CMS scope)

## Problem

`design/*.jsx` contains finished static mockups for Landing, Services, Projects,
Product Center (+ article detail), and Contact/SignIn. Only `Home()` (a
stripped-down version of `Landing`) was ever ported into `src/app/`. The other
pages don't exist as routes — visiting `/services`, `/projects`, `/product`, or
`/contact` 404s. Sign-in already exists at `/signin` and is out of scope.

Beyond just shipping the pages, all of their text content should be editable
by content admins without a code deploy — a CMS, not a hardcoded site.

## Goals

- Ship real Next.js routes for Services, Projects, Product Center (+ article
  detail), and Contact, and rework `/` to match the fuller `Landing()` mockup.
- Reuse existing Tailwind tokens and shadcn primitives instead of porting the
  mockups' inline `style={}` objects.
- Move every piece of editable text/content into the database — org
  identity/vision/mission/competencies, services, projects, contact reps, and
  articles — with full create/edit/delete admin UI for the repeatable lists
  and a single edit form for the org-profile singleton.
- Persist Contact form submissions and per-article feedback so officers can
  see them from the admin portal, instead of the mockups' local-only "sent"
  state.

## Out of scope

- Email notifications on new submissions or content changes.
- Porting the mockups' `useReveal()` scroll-fade animation.
- Real photography/map assets — placeholder blocks stand in.
- Versioning/drafts/preview for content edits — edits apply live immediately,
  matching how every other admin tool in this app works (roster, nav pins,
  quick links).

## Routes (public)

| Route | Source mockup | Notes |
|---|---|---|
| `/` (rework) | `Landing()` | Hero w/ stats, intro strip, vision/mission, competencies, OD explainer, article teaser, CTA band — all DB-backed |
| `/services` | `Services()` | Service cards (DB list) + `ProcessBand` + CTA band |
| `/projects` | `Projects()` | Flagship project blocks (DB list) + CTA band |
| `/product` | `ProductCenter()` | Filter/search over DB-backed articles |
| `/product/[slug]` | `Article()` | Article detail + feedback form + "keep reading" |
| `/contact` | `Contact()` | Reps list (DB) + map placeholder + form (persists to DB) |

`/signin` is unchanged.

## Shared layout

Extract the header (logo + nav + "Member sign in") and footer currently
inlined in `src/app/page.tsx` into shared components reused by every public
page. Add nav links: Services, Projects, Product Center, Contact, alongside
the existing "Member sign in" button. `/portal` keeps its own separate layout
— this only affects the public site, per the project rule that `/` stays
reader-first and the member workspace stays under `/portal`.

## Content model

Everything text-ish that a content admin should be able to change lives in
the DB. Layout/structure (the JSX, the order of sections on the page,
styling) stays in code — only the words and repeatable list items are data.

Two shapes:

1. **Singleton** — `orgProfile`: one row holding org identity, vision,
   mission, the "what is OD" blurb, the services-page intro line, and the
   three hero stat pairs and three competency blocks (fixed-size, edited
   inline as part of the same form — not separately addable/removable rows,
   since the page layout always shows exactly 3 of each).
2. **Repeatable lists** — `services`, `projects`, `contactReps`, `articles`:
   each a table with a `position` column for ordering, full CRUD from admin.

## Schema additions (`src/db/schema.ts`)

```ts
orgProfile: {
  id: text primary key,            // fixed "org" — singleton row
  name: text not null,
  fullName: text not null,
  tagline: text not null,
  blurb: text not null,
  vision: text not null,
  mission: text not null,
  whatIsOd: text not null,
  servicesIntro: text not null,
  email: text not null,
  facebookLabel: text not null,
  facebookUrl: text not null,
  room: text not null,
  campus: text not null,
  heroStats: text (mode: "json") not null,    // [{ value, label }] x3
  competencies: text (mode: "json") not null, // [{ title, body }] x3
  updatedAt: integer (timestamp_ms), default nowMs
}

services: {
  id: text primary key,            // createId("svc")
  tag: text not null,
  title: text not null,
  summary: text not null,
  meta: text not null,
  points: text (mode: "json") not null,  // string[]
  position: integer not null,
  createdAt / updatedAt: integer (timestamp_ms), default nowMs
}

projects: {
  id: text primary key,            // createId("prj")
  shortCode: text not null,        // e.g. "YH", "XC"
  name: text not null,
  kicker: text not null,
  theme: text not null,
  summary: text not null,
  goals: text (mode: "json") not null,  // string[]
  stats: text (mode: "json") not null,  // [{ k, v }]
  position: integer not null,
  createdAt / updatedAt: integer (timestamp_ms), default nowMs
}

contactReps: {
  id: text primary key,            // createId("rep")
  role: text not null,
  scope: text not null,
  email: text not null,
  position: integer not null,
  createdAt / updatedAt: integer (timestamp_ms), default nowMs
}

articles: {
  id: text primary key,            // createId("art")
  slug: text unique not null,
  title: text not null,
  category: text not null,
  readMinutes: integer not null,
  author: text not null,
  publishedAt: integer (timestamp_ms) not null,
  dek: text not null,
  abstract: text not null,
  sections: text (mode: "json") not null,   // [{ h, body, figure }]
  components: text (mode: "json") not null, // { title, items: [{ name, def, ex }] }
  questions: text (mode: "json") not null,  // string[]
  refs: text (mode: "json") not null,       // string[]
  createdAt / updatedAt: integer (timestamp_ms), default nowMs
}

contactSubmissions: {
  id: text primary key,            // createId("cts")
  name: text not null,
  organization: text not null,
  email: text not null,
  orgSegment: text not null,       // "within_ls" | "outside_ls" | "not_sure"
  message: text not null,
  createdAt: integer (timestamp_ms), default nowMs
}

articleFeedback: {
  id: text primary key,            // createId("fbk")
  articleId: text not null references articles.id (onDelete: "cascade"),
  rating: integer not null,        // 1-5
  comment: text nullable,
  createdAt: integer (timestamp_ms), default nowMs
}
```

No JSON columns exist elsewhere in the schema yet, but Drizzle's
`text(..., { mode: "json" })` is the standard SQLite escape hatch for the
fixed-shape arrays above (hero stats, competencies, service points, project
goals/stats, article body) — normalizing each into its own child table would
add five join tables for data that's never queried independently of its
parent row.

Indexes, matching the existing convention (e.g. `nav_pins_position_idx`,
`quick_links_position_idx`):
- `services_position_idx`, `projects_position_idx`, `contact_reps_position_idx`
  on each table's `position` column (admin list ordering + public read order).
- `articles_slug_idx` (unique, backs `getBySlug`) and
  `articles_published_at_idx` (public list sort/filter).
- `contact_submissions_created_at_idx` and
  `article_feedback_article_id_idx` + `article_feedback_created_at_idx`
  (admin submissions view sorts newest-first and filters by article).

### Permissions

Add a new role `"public_content_admin"` to `roleKeys` in
`src/server/auth/permissions.ts`, with a new permission action
`"public_content:manage"` granted to it — a dedicated role distinct from
`member_admin`, so a comms/PR officer can edit the public site without also
getting roster/nav/submissions access. Display label in the admin UI:
**"Public Content Admin"**.

Add `"submission:view"` as well, granted to the existing `member_admin` role
(the role that already owns roster/nav/quick-links admin via
`roster:manage`/`nav:configure`) — unchanged from the previous revision of
this design. `member_admin`'s permissions are not changing.

Correction from the first draft: surveys, reporting, and short-links admin
are gated by `survey:configure`, `retention:record`, and `link:moderate`
respectively (the `survey`/`retention`/`link` roles), **not** by
`member_admin`. The "Member Content Admin" label in the Admin panel section
below refers only to the modules `member_admin` actually owns
(roster, nav pins, quick links, submissions) — it is a display label for
that one role's existing grant, not a new grouping that spans roles it
doesn't have.

`roleKeys` in `permissions.ts` is a closed TypeScript union used by `can()`,
but actual role *grants* are rows in the `roles` table (`src/db/schema.ts`)
joined to members via `memberRoles` — adding `"public_content_admin"` to the
union is necessary but not sufficient. The migration must also insert a
`roles` row (`key: "public_content_admin"`, with a label/description) so it
can be assigned to a member through the existing roster role-assignment UI
the same way `member_admin` already is.

## Public write paths

- `POST /api/contact` — public, unauthenticated. `zod`-validates: `name`
  (1-120 chars), `organization` (1-160), `email` (valid email, max 200),
  `orgSegment` (enum), `message` (1-2000 chars). Rate-limited via the
  existing `checkRateLimit` helper with bucket key `contact:<ip>` (limit:
  5 per 10 minutes — generous for a real inquiry, tight enough to stop a
  script). Inserts into `contactSubmissions`. No audit log entry — there's
  no actor to attribute it to.
- `POST /api/articles/[slug]/feedback` — same validation pattern: `rating`
  (`z.number().int().min(1).max(5)`), `comment` (optional, max 1000 chars).
  Bucket key `feedback:<ip>:<slug>` (limit: 3 per 10 minutes per article).
  Inserts into `articleFeedback`.

Both routes skip `Actor`-based authorization (they're intentionally public)
and rely on rate limiting plus the length/shape caps above as the spam
guard. IP comes from the same header Cloudflare Workers already populate
for other rate-limited routes in this app (`CF-Connecting-IP`) — reuse
whatever existing helper reads that, don't re-derive it.

## Repositories

Public reads (no actor check, used by the public pages):
- `orgProfile.ts` — `get()`
- `services.ts`, `projects.ts`, `contactReps.ts` — `list()` (ordered by `position`)
- `articles.ts` — `list()`, `getBySlug(slug)`

Admin writes (gated by `can(actor, "public_content:manage")`, following the
existing repository pattern in e.g. `quickLinks.ts`):
- `orgProfile.ts` — `update(actor, input)`
- `services.ts`, `projects.ts`, `contactReps.ts`, `articles.ts` —
  `create(actor, input)`, `update(actor, id, input)`, `remove(actor, id)`,
  `reorder(actor, orderedIds)`

Submission reads/writes (separate concern, `submission:view` / public create):
- `contactSubmissions.ts`, `articleFeedback.ts` — `create(input)` (no actor,
  public) and `list(actor)` (gated by `can(actor, "submission:view")`)

Each list/create/update mutation calls `audit.record(actor, …)` the same way
`quickLinks.ts` does, so content edits show up in the existing audit log.

## Admin panel

`/portal/admin` groups its module cards under two headings: **"Public
Content Admin"** (new — gated by `public_content:manage`: org profile,
services, projects, contact reps, articles) and **"Member Content Admin"**
(the existing `member_admin`-gated modules only: roster, nav pins, quick
links), plus the new read-only **Submissions** card (`submission:view`,
also `member_admin`). Surveys, reporting, and short-links keep their current
gates (`survey:configure`, `retention:record`, `link:moderate`) and stay
outside both headings — they aren't `member_admin` modules today and this
design doesn't change that.

Every new admin page follows the exact pattern already used by
`/portal/admin/quick-links` (`page.tsx` + `actions.ts`): a server component
page with a "create" form at the top and a table below where each row is its
own `<form action={updateXAction}>` (hidden fields for the unchanged columns,
editable inputs for the rest) plus a one-button `<form action={deleteXAction}>`.
Actions are `"use server"` functions that `requireActor()`, validate with
`zod`, call the repository, then `revalidatePath()` both the sub-page and
`/portal/admin`. No client-side state, no new form library — matches every
other admin CRUD page in this app.

**`/portal/admin/content/org-profile`** (single row, no list/delete) —
one `page.tsx` + `actions.ts` with a single `updateOrgProfileAction`. Fields:
`name`, `fullName`, `tagline`, `blurb`, `vision`, `mission`, `whatIsOd`,
`servicesIntro` (textareas/inputs as appropriate), `email`, `facebookLabel`,
`facebookUrl`, `room`, `campus`. The 3 hero stats and 3 competencies are
fixed-count, rendered as 3 explicit `{value, label}` / `{title, body}` input
pairs in the same form (not a generic add/remove list) and reassembled into
the `heroStats`/`competencies` JSON columns on submit.

**`/portal/admin/content/services`** — create form: `tag`, `title`,
`summary`, `meta`, `position`, plus `points` as a textarea (one bullet per
line, split on `\n` into the `points` JSON array). Table: one row per
service with the same fields editable inline, "Save" + "Remove" per row —
identical shape to quick-links.

**`/portal/admin/content/projects`** — create form: `shortCode`, `name`,
`kicker`, `theme`, `summary`, `position`, `goals` (textarea, one per line),
`stats` (textarea, one `key|value` pair per line, e.g. `160+|partner
organizations`, split on `|`). Table: same inline edit/remove shape.

**`/portal/admin/content/contact-reps`** — create form: `role`, `scope`,
`email`, `position`. Table: same inline edit/remove shape. Simplest of the
five — flat fields only, no JSON columns.

**`/portal/admin/content/articles`** — the richest form, still flat
inputs/textareas (no nested array builder UI):
- Flat fields: `slug`, `title`, `category`, `readMinutes`, `author`,
  `publishedAt`, `dek`, `abstract`.
- `sections`: one textarea, one section per line as
  `heading ||| body ||| figure caption`, split on `|||`.
- `components`: a `componentsTitle` input plus one textarea for items, one
  per line as `name ||| definition ||| example`.
- `questions`: textarea, one question per line.
- `refs`: textarea, one reference per line.
This delimiter-line convention keeps every new admin form a plain
`<form>` of inputs/textareas — consistent with the rest of the app — instead
of introducing a dynamic add-row JS component for a content type that gets
edited rarely. The placeholder text on each textarea documents the delimiter.

**`/portal/admin/submissions`** (`submission:view`) — two tabs (existing
`tabs.tsx`), "Contact" and "Article feedback", each a table (existing
`table.tsx`) of rows newest-first. Read-only, no actions.

## Visual conversion

The mockups are inline-style JSX using CSS vars (`var(--navy)`, `var(--mid)`,
etc.) defined in `design/tokens.css`. Those map directly onto Tailwind tokens
already in `src/app/globals.css` (`--primary` = navy `#06192f`, `--accent` =
mid blue). Pages are rebuilt as Tailwind + existing shadcn primitives
(`Card`, `Button`, `Badge`, `Input`, `Textarea`, `Select`, `Tabs`), following
`Home`'s current pattern (`bg-primary text-primary-foreground`,
radial-gradient hero overlay via an absolutely-positioned div) rather than
porting the mockups' `style={}` objects verbatim.

A shared `<PlaceholderBlock label ratio>` component (gray block + caption)
replaces the mockups' `Placeholder` for photo/map slots — real assets swap in
later with no layout change.

**Rendering admin-edited content:** every field above (org profile, services,
projects, contact reps, article bodies) renders as plain JSX text content
(`{value}`), never `dangerouslySetInnerHTML` — React escapes it
automatically. `public_content_admin` is a trusted officer role, not an
untrusted-user input path, but there's no reason to introduce an XSS surface
for a feature that has zero need for rich HTML. If a future revision wants
bold/links in article bodies, that needs an explicit sanitizer (e.g. an
allowlist via `rehype-sanitize`) added at that time — not implicit HTML
rendering now.

## Testing

- Repository tests: `*.integration.test.ts` per existing convention covering
  create/update/remove/reorder and the `public_content:manage` / `submission:view`
  permission gates for each new repository.
- API route tests: rate-limit behavior and validation for both public POST
  routes.
- No page-level/component tests exist elsewhere in the app for static pages;
  this design doesn't add any either. All public pages now read from the DB
  on every request, so they move to `force-dynamic` (matching the existing
  rule: `force-static` only when content has no per-request state, which no
  longer applies once Home/Services/Projects/Contact read `orgProfile` /
  `services` / `projects` / `contactReps`).

## Migration & seeding

- Drizzle migration adds the seven new tables (`orgProfile`, `services`,
  `projects`, `contactReps`, `articles`, `contactSubmissions`,
  `articleFeedback`) plus a `roles` row for `public_content_admin`.
- The migration itself inserts the one `orgProfile` singleton row (with the
  current `design/data.jsx` org copy as defaults) — not just the dev seed
  script. Every public page reads `orgProfile.get()` on every request; if
  that row only existed via a dev-only seed script, any environment where
  the seed didn't run (a fresh prod D1, a future env) would 500 on `/`.
  Shipping the default row in the migration itself makes the table
  self-sufficient.
- Dev seed data additionally inserts the 3 `services`, 2 `projects`,
  3 `contactReps`, and 3 `articles` rows from `design/data.jsx`, so the
  public site renders the same copy it has today immediately after
  migrating — only the source of truth moves.

## Deployment

Per `CLAUDE.md`: show the exact command and wait for approval before
running it against dev:

```
pnpm exec wrangler d1 migrations apply DB --env dev --remote
```

(this is what `pnpm db:migrate:dev` wraps). Then `pnpm deploy:dev`.

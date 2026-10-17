# Member Library v2 — Design

Date: 2026-10-16
Status: Draft for review
Owner: CJ (portal), on behalf of Training, Research, and Development (TRD) and the Office of the Secretary-General (OSG), who maintain today's "CODE Document and Framework Library" Google Sheet

## 1. Intent

CODErs keep a Google Sheet called the "CODE Document and Framework Library". It indexes past IDFs and modules, outside books and papers, organizational-development frameworks, and a few websites, each linked to Google Drive. Members use it in one way above all: **when they write their next module or IDF.** They search by topic (say, "Accountability") and format (say, SLE), open two or three past examples plus a framework, adapt them, and cite them. CJ confirmed this job directly.

The sheet does that job badly. Search is a formula you have to type `%` into. There are about 218 free-text topics, full of typos and near-duplicates. Links die: 105 of the older module links now return "File not found" even when signed in, most likely because they lived in graduated members' Ateneo accounts, which Ateneo deletes. Some files were never scrubbed of client data. Nobody can tell what's popular or useful.

The portal already has a member Library. It is a thin, admin-only, plain-text version that is switched on only in beta (section 2). This project turns it into the place CODErs actually go to write their next module, and the place they share what they make.

- All the sheet's content moves in. Files are copied into our own R2 storage instead of pointing at Drive links.
- Any member can add to it: upload a file (an IDF, a template), write a page (a guide, a personal article such as "How I built CODE Portal and how to get into full-stack web development"), or add a link.
- Members save items to lists, share and co-edit those lists like music playlists, and leave notes on what they saved.
- Popularity is visible: saves, opens, and total hours spent reading.
- Search understands meaning without looking like an AI product.
- Everything stays members-only for this soft launch. Each item carries a label saying whether it could one day go public. The library home explains the idea of a public CODE library: a source of reliable, youth-org-specific know-how, because most material online is written for businesses and doesn't translate well to student organizations.

### Why now

CJ wants to release the library. The sheet's links are rotting (see the dead-link counts above). The parts needed to build this now exist: R2 uploads, the email system's block editor, notifications, and audit logging.

### What success looks like

- A member writing a module finds two or three relevant past modules and a framework in under a minute, from the portal, on a phone or a laptop.
- TRD retires the Google Sheet as the place people look things up.
- Members add their own material without asking an admin: IDFs, templates, guides, personal articles.
- Shared lists ("STE starter pack") get passed around and built together.
- The beta soak (section 18) passes, and CJ turns it on in production.

## 2. Current state

### 2.1 What exists and is reused

- **Tables** (all from `drizzle/migrations/0004_unify_schema.sql`): `library_items` (`schema.ts:690`), `library_comments` (719), `library_favorites` (739), `library_lists` (753), `library_list_items` (763). `kind` and `confidentiality` have no CHECK constraints, so widening them needs no migration.
- **Repository** `src/db/repositories/library.ts`: list/get/create/update/remove items, comments with anonymous posting and moderator hide, favorites, lists, list items, and `requestAccess` (writes an audit row only).
- **Member pages** `/portal/library`, `/portal/library/[id]`, `/portal/library/lists`. **Admin page** `/portal/admin/content/library`.
- **Permissions** `library:manage` and `library:moderate`, both granted through the `publishing` role (`src/server/auth/permissions.ts:39-40, 60`).
- **Flag** `FEATURE_LIBRARY` (`src/server/features.ts`, `src/server/env.ts:42`). On in beta (`wrangler.beta.jsonc:44`), off in staging and prod.
- **Uploads** `src/server/uploads.ts` (`createUploadHandlers`, `parseNamespace`), routes `src/app/api/uploads/route.ts` and `src/app/api/uploads/[key]/route.ts`, plus the shared-dev `src/server/internal/uploads.ts`, storage adapter `src/storage/`, R2 bucket bound as `BUCKET` (beta: `code-nest-dev-uploads`). The purpose list is duplicated in `src/db/contract/uploads.ts:7`.
- **Email block editor** `src/components/email/block-editor.tsx` and block schema `src/lib/email/blocks.ts`: heading, text, button, image, divider, spacer and event blocks, validated with Zod, at most 60 blocks.
- **Notifications** `notify()` in `src/db/repositories/notifications.ts`, gated by `FEATURE_NOTIFICATIONS`.
- **Audit** with category `"library"` already defined.
- **Terms** table (`schema.ts:405`) for "this term" windows.
- **Public website guides** (three of them) hardcoded in `src/content/site.ts` (`ARTICLES`, line 154), rendered at `/product/[slug]`. They share no code with the library.

### 2.2 What is broken or missing

- `listItems` loads the newest 100 rows, then filters and searches **in JavaScript**. Anything past row 100 silently disappears. With about 210 seed items this has to move into SQL.
- No status column (no drafts, no review, no takedown), no file or URL fields, no author display, no tags table, no view counts.
- Content is plain text. The admin form forces each section body onto a single line.
- Lists can be created but not opened, edited, or filled from the item page. `addToListAction`, `removeFromListAction` and `requestAccessAction` exist but are never used.
- Comments: there is no reply form. `addComment` and `toggleFavorite` don't check whether the member can see the item.
- Uploads accept only images up to 5 MB. Private R2 objects check only "is signed in", not per-object access. Responses send no `Content-Disposition`.
- No AI or Vectorize bindings exist in any wrangler config.
- No tests for the library.

## 3. Goals, non-goals, anti-goals

### Goals

1. Import the sheet's content, with files copied into R2.
2. Members can upload files, write pages, and add links, with drafts.
3. One search with Type, Source and Tag filters over a cleaned tag set, plus an optional smart search.
4. Saves and lists that can be shared and co-edited, with notes and comments.
5. Popularity: saves, opens, downloads and active reading time, shown by the rules in section 10.
6. Moderation: takedown, approval of client-data items, reports, retagging.
7. A public-readiness label on every item and a "Toward a public library" pitch on the library home.

### Non-goals (this release)

- **Going public.** Nothing is public. Deciding what can go public is later work.
- **Defining "S7 confidential".** The confidential tier keeps today's behavior (section 5.6). Who sees it and what goes there is decided later.
- **Engagement Planning Pages.** Team boards with tasks, sections and team-private files are the next project, built on top of this release's lists (section 9.6).
- **Written AI answers.** Smart search never writes sentences (section 12).
- **PDF highlighting or annotation.** Per-item notes in lists cover most of the need.
- **Converting Word files to PDF.** Word files are download-only.
- **A member directory or "message the author".**
- **Changing `/product`** or the public site.

### Anti-goals (failure even if it technically works)

- **Anything from the sheet ends up in git.** The repository `CJ-Uy/CODE-Portal` is **public** and the sheet says "FOR CODE'S INTERNAL USE ONLY". Titles, author names, file contents, the import manifest and generated seed SQL must never be committed (section 15.1).
- **Unredacted client data shows up for all members** because the client-data question was skipped or ignored.
- **Smart search feels like a chatbot.** Sparkles, "AI" badges, or generated text would give members the ick and break CJ's explicit instruction.
- **Reading-hours numbers that are obviously fake** (idle tabs counting for hours) or that reveal who read what.
- **A launch that looks empty** because seeded items are stuck in a review queue.

## 4. Decisions

### 4.1 Decided by CJ

1. **Purpose.** The library's main job is helping a member write their next module or IDF.
2. **Layout.** The library home leads with **collections**: curated starter packs such as "Write your first module", "Run a diagnosis", "Set up a youth org from zero", "Plan a GA or event", "Get into tech". Under them sits **one search** with three filters: **Type**, **Source** and **Tags**. Shelves-by-type was the rejected alternative.
3. **Types:** Module/IDF · Template · Framework · Guide · Article · Case study · Book/paper · Website. **Sources:** Made by CODE · From members · From outside. Every item uses one of **three formats**: file, page or link.
4. **Personal articles** by any member are supported. For example, CJ's planned "How I built CODE Portal / getting into full-stack" goes in as an Article.
5. **Publishing.** Everything goes live right away. Library moderators can take any item down. Drafts exist for work that isn't ready.
6. **Client data** is the one case that needs approval before going live.
7. **Confidential tier kept** in case S7 needs it. Its rules come later. This release is a **members-only soft launch**, and every seeded item is `members`.
8. **Public readiness.** A per-item label plus the public-library pitch ship now. The real decisions about what goes public come later.
9. **Popularity.** Save counts on cards, hidden below 3. A "Most saved this term" shelf. Authors see full stats on their own items. Items are ranked, people never are. Opens and a **total reading-hours counter** are shown too.
10. **Lists.** Members can share lists and **collaborate** on them like playlists. Everyone who can see a shared list sees its notes and comments.
11. **Engagement Planning Pages** (team planning) is a separate next project, not part of this release.
12. **Editor.** Option B: extend the email block editor (section 11).
13. **Tags.** Pick from the cleaned list or create a new tag, which goes live right away. Moderators rename, merge and regroup tags. **Admins and moderators can retag any item.**
14. **Smart search never writes, for now.** It only suggests keywords, ranks results, and fills the Related shelf.
15. **Files move to R2.** No Drive links as the source of truth.
16. **Release bar** for production, as in section 18.
17. **Client data in the seed files gets reviewed before upload** (section 15.6). Nobody knows which files were never scrubbed, so Claude reads every seed document and decides for each one:
    - **clean:** publish as-is.
    - **redact:** remove the client details, then publish the redacted copy.
    - **confidential:** mark it confidential when redaction isn't safe or possible.
18. **Members never delete.** Owners edit, and the item page always shows the latest version. Only a library admin (`library:manage`) can delete an item, and a deleted item disappears quietly, as in section 6.3.

### 4.2 Calls made by Claude (flagged so CJ can override)

1. **"Save" and "favorite" become one thing.** The Save button adds to a default **Saved** list or any other list. The `library_favorites` table is migrated into each member's Saved list and then dropped. An item's save count is the number of distinct members who added it to any list, however many lists hold it.
2. **The client-data question** is required whenever an item is published: *"Does this include client names or client data?"* No: it goes live. Yes: it goes to `pending_review`.
3. **Taken down is not deleted.** The owner still sees the item with the moderator's reason and can edit it. Only a moderator can republish it. Nothing is hard-deleted by a takedown.
4. **A Report button** on every item and list, sending reports to library moderators.
5. **Seeded items skip the review queue.** After the client-data review (decision 17), clean and redacted documents go in as `published`, because they were already open to every CODEr through the sheet. Starting them in review would launch an empty library. Documents the review flags go in as `confidential`. TRD spot-checks a sample of the redactions during the soak.
6. **Reading time** counts only active time, measured as in section 10.
7. **Reading privacy.** Per-member reading data is never shown to anyone, including authors and moderators. Only totals are shown.
8. **Templates and Case studies** added as types. The activity bank and glossary were considered and skipped; tags and a guide cover them.
9. **The three website guides** are copied into the library as Guides. `/product` is untouched until the public decision.
10. **Authors.** An item can have **several authors**: 8 of the 142 sheet documents list two people, and many readings have multiple authors. Each author shows by name. An author who is a current portal member gets a "Still in CODE" chip, mirroring the sheet's green highlight. Authors are a display credit only. They don't grant edit rights; ownership does (call 18).
11. **Files.** The 11 Word files are download-only with a "Word" chip, but their text is still indexed. The upload cap is 50 MB (the largest seed file is 32 MB). PDFs preview inline. Office files are download-only.
12. **The three demo items** currently in beta (`lib_onboarding`, `lib_events_playbook`, `lib_internal_notes`) are removed.
13. **Smart search switch.** It is on by default and remembered per member. The `FEATURE_LIBRARY_SMART_SEARCH` flag can turn it off for a whole environment.
14. **List roles.** A list has one owner plus **editors**. The share switch makes every member a viewer and commenter. There is no separate viewer list.
15. **Files that couldn't be fetched are skipped:** 7 internal files, 5 external files, and the 105 dead older modules. The list of them stays in the local manifest for TRD to chase.
16. **A multilingual embedding model** (for example `@cf/baai/bge-m3`), because modules mix English and Filipino.
17. **Notifications** as in section 14.
18. **Ownership is separate from authorship.** Every item has at most one **owner** (`created_by`). The owner edits the item, publishes it, sees its stats on `/mine`, and gets its notifications. The member who creates an item owns it. **Seeded items** are owned by their author when exactly one listed author matches a current portal member. Otherwise they have no owner (`created_by` null) and moderators manage them. The import itself is attributed to CJ in the audit log, not through ownership, so CJ doesn't inherit about 210 items.
19. **Content edits** (title, file, blocks, facets, authors) are allowed for the owner and for `library:moderate` holders, so moderators can fix a "wrong or broken file" report without a takedown. List editors never get edit rights over the items in their list.
20. **Taking down a list** sets `taken_down_at` and `moderation_reason` on the list, turns sharing off and unpins it. While taken down, the owner and editors still see the list with the reason, but can't share it again. A moderator restores it.

## 5. Content model

### 5.1 Formats

| Format | What the item page shows | Typical types |
|---|---|---|
| `file` | Inline PDF preview (or a download card for Office files), download button, author, year, facets | Module/IDF, Template, Book/paper |
| `page` | Rendered blocks with images, headings and read time | Framework, Guide, Article, Case study |
| `link` | A card that opens the site in a new tab, plus a description | Website; also Book/paper when only a web page exists (for example the three IDEO pages) |

`format` is stored explicitly. It can't be derived from type, because a Book/paper can be either a file or a link.

### 5.2 Types (stored in `kind`)

`code_document` (shown as "Module/IDF") · `template` · `framework` · `guide` · `article` · `case_study` · `reading` (shown as "Book/paper") · `website`. These replace today's `article | case_study` union. Existing values map to themselves.

### 5.3 Source

`code` (Made by CODE) · `member` (From members) · `outside` (From outside). It defaults from the type (`article` → `member`; `reading` and `website` → `outside`; everything else → `code`) and the author can change it.

### 5.4 Facets (filters, not tags)

- `subtype`: for `code_document`, one of IDF · Module · Topic Resource. For `reading`, Book · Academic Article · Report · Other.
- `format_detail`: the module format, normalized from the sheet's "Module: SLE" style values. Values: SLE · Lectivity · Reflectivity · Lecture · Reflecture · FGD · Activity · Consultation Session · Simulation · Learning Circle · Other. Combined values such as "Lecture, SLE" become the first one, and the second one becomes a tag.
- `engagement_type`: STE · LTE · C-Team (case-normalized; "N/A" becomes empty).
- `year`: the year written.

### 5.5 Public readiness

Each item has one of four values: `null` (not reviewed yet), `not_eligible`, `needs_adapting`, `public_ready`. `reading` and `website` default to `not_eligible` because they are copyrighted or third-party. Everything else defaults to `null`. Only moderators set this. Cards show a small label only when the value isn't `null`.

### 5.6 Confidentiality

`members` (default) or `confidential`. The existing value `public` stays legal in the type but isn't used or offered. **Confidential behavior is unchanged**: only `library:manage` holders can see it, everyone else gets a 404. Only `library:manage` can set confidentiality. Confidential items are excluded from save counts, collections and the Related shelf for members who can't see them.

## 6. Publishing flow

### 6.1 Statuses

`draft → (pending_review) → published → taken_down`

| From | To | Who | Trigger |
|---|---|---|---|
| — | `draft` | any member (becomes owner) | "Save draft" on a new item |
| `draft` | `published` | the owner | Publish, answering "No client data" |
| `draft` | `pending_review` | the owner | Publish, answering "Yes, includes client data" |
| `pending_review` | `published` | moderator | Approve |
| `pending_review` | `draft` | moderator | Send back, with a required reason |
| `published` | `taken_down` | moderator | Take down, with a required reason |
| `taken_down` | `published` | moderator | Restore |

- Drafts, pending items and taken-down items are visible only to their owner and to moderators. Lists that contain them show everyone else a placeholder card reading "Not available".
- An owner editing a published item doesn't change its status. Changing the client-data answer from No to Yes moves the item back to `pending_review`.
- Every transition writes an audit row (category `library`). The owner gets a notification on approve, send-back, takedown and restore. Ownerless seeded items notify no one.

### 6.2 Reports

A Report button on items and shared lists. It takes a reason from a fixed list (client data · inappropriate · copyright · wrong or broken file · other) plus optional text. Reports show up in the moderation queue. Moderators resolve each report with "dismiss" or "take down".

### 6.3 Deletion and editing (decision 18)

- **Members can't delete anything,** published items or drafts. They can't unpublish either. Once an item is published, it stays up unless a moderator takes it down or an admin deletes it.
- **Owners edit in place.** Every viewer sees the latest version. Old versions aren't kept.
- **Only `library:manage` can delete,** with a typed confirmation. A member who wants something gone asks a library admin.
- **Deletion is quiet:**
  - The item, its tags, its comments, its activity rows and its list entries are all removed.
  - Lists that held it just lose that row. There's no placeholder and no notification to list owners.
  - Its R2 objects are deleted.
  - The audit log keeps one row (title, owner, who deleted it, when).

## 7. Discovery

### 7.1 Library home `/portal/library`

From top to bottom:

1. **The "Toward a public library" pitch.** A short banner members can dismiss, linking to `/portal/library/about`. The page carries the full pitch:
   - CODE's years of hands-on organization-development work with student organizations.
   - Why business-oriented advice online often doesn't fit youth orgs: volunteer members, turnover every year, the academic calendar, small budgets.
   - The hope that this library becomes a reliable public resource.
   - What the public-readiness labels mean.

   The builder drafts this copy and CJ edits it.
2. **The search bar** with the smart-search keyword chips (section 12), and the filters for Type, Source and Tags. Tags are grouped. The facets from 5.4 appear when Type = Module/IDF.
3. **Collections.** Lists pinned by moderators (section 9.5), shown as a horizontal shelf.
4. **Most saved this term.** Items with the most new saves since the current term started (`terms` table).
5. **The reading counter:** "1,204 hours of reading so far", summed over all items.
6. **Recently added.**

Once a search or filter is active, sections 3–6 give way to the results list. Sort options: Relevance (default when there's a query), Newest, Most saved, Most read.

### 7.2 Search (plain)

Search and filtering run **in SQL**. This fixes the 100-row bug. Plain keyword search matches title, summary, author, tags and extracted text. Recommendation: an SQLite FTS5 virtual table (D1 and the local SQLite both support FTS5). It is created in a raw-SQL migration, because Drizzle doesn't model virtual tables. The builder may choose `LIKE` instead if FTS5 causes trouble with D1 or the local runner. Results always apply status, confidentiality and permission filters in SQL.

### 7.3 Tags

- Stored in `library_tags` (with a group) plus the join table `library_item_tags`, replacing `topics_json`.
- **Starting set:** 37 tags in 7 groups (6 organization-development groups plus Member Writing). The import maps all 218 raw sheet topics onto them.
  - **Direction & Strategy:** Vision & Mission (VMOS) · Strategic Planning · Goal Setting · Alignment · Advocacy
  - **Structure & Systems:** Org Design · Processes, Systems & Structures (PSS) · Constitution & Internal Rules · Roles & Responsibilities · Systems Thinking
  - **Diagnosis & Change:** Diagnosis · Change Management · Root Cause Analysis · Monitoring & Evaluation · Stakeholder Analysis
  - **People & Culture:** Org Culture · Member Engagement · Motivation · Teamwork & Collaboration · Accountability · Communication & Feedback · Well-being & Burnout · Diversity & Inclusion
  - **Leadership:** Leadership · Self-Awareness & Growth · Transitions & Turnover
  - **Methods:** Design Thinking / HCD · Design Sprint · Behavioral Design · Facilitation · Appreciative Inquiry · Ideation · Project Management · Module Design · Problem Solving
  - **Member Writing:** Tech & Digital Tools · Career & Skills
- **The mapping** from raw topics to tags lives in the local manifest (section 15). CJ (or TRD) reviews it before the seed runs.
- **Authors** pick tags from the grouped list or click "Create tag". A new tag is live right away, in an "Ungrouped" group.
- **Moderators** can rename, merge (which retags every affected item), regroup and delete tags, and can edit tags on any item. Every one of these actions is audited.

### 7.4 Related shelf

The item page shows up to 6 related items. With smart search on, related means similar by embedding, boosted by shared tags and shared frameworks. With it off, related means "shares the most tags", ties broken by save count.

## 8. Item page `/portal/library/[id]`

- **Header:** type and source chips, public-readiness label (when set), title, summary, authors (each with a "Still in CODE" chip when they're a current member), year, facets, tags.
- **Actions:** Save (opens the list picker), Download (file items), Open site (link items), Report, and Edit (owner or moderator).
- **Body by format:**
  - **File:** an inline PDF preview using the browser's built-in viewer (`<iframe>` or `<object>` pointed at the storage route with `Content-Disposition: inline`). Mobile browsers that won't render inline PDFs get a clear "Open PDF" button. Office files show a download card.
  - **Page:** the rendered blocks (section 11).
  - **Link:** the description plus a big "Open site" card.
- **Stats line:** "Saved by 12 · Opened 340 times by 61 members · 37 hours read". The save count is hidden below 3. Opens and hours always show.
- **Comments:** the existing thread, plus a **reply form**. Anonymous posting stays, and moderators can hide comments. `addComment` must check that the member can see the item.
- **Related shelf.**
- **Moderator controls:** take down or restore, set public readiness, retag, and (for `library:manage`) set confidentiality.

## 9. Lists

### 9.1 Saving

The Save button opens a picker: **Saved** (the member's default list, created on first use), the member's other lists, lists they can edit, and "New list". An item can sit in several lists. "Saved by N" counts distinct members.

### 9.2 Lists page `/portal/library/lists` and list page `/portal/library/lists/[id]`

- `/lists` shows **My lists**, **Shared with me** (lists I can edit), and **Collections**.
- A list page shows the name, description, owner and editors, and its items in order. Each item row has: the item card, a **note**, "added by Ana · 2d", drag to reorder (editors only), and remove (editors only).
- Below the items is a **comment thread on the list**. It reuses the library comment rules: anonymous posting allowed, moderators can hide.

### 9.3 Roles and sharing

- **Owner.** Exactly one. Can rename, delete, add and remove editors, toggle sharing, and do everything an editor can.
- **Editor.** Adds, removes and reorders items, edits notes, and adds items by uploading (9.4).
- **"Share with members" switch.** Off by default. When on, any signed-in member with the link can view the list and comment on it. When off, only the owner and editors can open it.
- **Visibility.** Notes, comments and "added by" are visible to everyone who can open the list (decision 4.1.10).
- **Items a viewer can't see.** Drafts, taken-down items and confidential items in a list show as a "Not available" placeholder for viewers who can't open them.

### 9.4 Uploading from a list

"Add → Upload / Write / Link" on a list page opens the normal create flow. When the item is saved, it is added to that list. The item follows every normal rule (drafts, the client-data question, going live right away). Lists never hold files of their own.

### 9.5 Collections

A collection is a shared list owned by any member, which a moderator marks as **pinned**. Pinned lists appear on the library home, in an order moderators set. Seed: the builder drafts 4–5 collections from the imported items (titles as in 4.1.2) as pinned lists owned by CJ. CJ or TRD edits them during the soak.

### 9.6 Built to grow into Engagement Planning Pages

Keep list members with roles, ordered items with notes, and list comments as general building blocks. Planning Pages will add teams, sections, tasks and team-private files on top. Don't add any of those now.

## 10. Popularity and reading time

### 10.1 What is measured

| Measure | Definition |
|---|---|
| Save | A distinct member who has added the item to any list (from `library_list_items.added_by`) |
| Open | Each time the item page mounts in the browser. Counted from the client, not during server render, so Next.js link prefetches don't inflate it |
| Download | Each file download (the storage route with `?download=1`, or the client click; builder's choice) |
| Active seconds | Time with the tab visible **and** a scroll, pointer, key or touch event in the last 60 seconds |

### 10.2 How it reaches the server

- The item page sends a ping roughly every 15 seconds of active time, and a final ping on `visibilitychange` to hidden, using `navigator.sendBeacon`.
- `POST /api/library/[id]/activity` with `{ kind: "open" | "active" | "download", seconds? }`.
- The server clamps each ping to at most 30 seconds, caps each member at **2 hours per item per day**, and rate-limits pings.
- Pings for items the member can't see are ignored.
- File reading time counts only while the inline preview is on the item page. Downloaded files add downloads, not hours.

### 10.3 Storage

The table `library_item_member_days` has one row per (item, member, day), with columns `opens`, `active_seconds` and `downloads`. "Day" is the calendar day in UTC+8, matching the calendar feature. Every number in this spec is a sum or count over this table plus the list tables. Nothing else needs keeping in sync.

### 10.4 Display rules

- **Cards:** "Saved by N" when N ≥ 3. Nothing otherwise.
- **Item page:** the full stats line (section 8).
- **Library home:** "Most saved this term" and the total hours counter.
- **`/portal/library/mine`:** the member's owned items grouped by status (drafts, pending, published, taken down), each with saves, opens, unique readers, hours and downloads, with a simple per-week chart. Reuse the retention chart components if they fit.
- **Never shown, to anyone:** which members read, opened or downloaded what. No ranking of members.

## 11. Writing pages (block editor)

The email block editor's model and UI are extended into a library block editor. This can be a shared core with separate block palettes, or a fork. The builder chooses, but must not break email.

- **Blocks:**
  - heading (levels 2 and 3)
  - text (supports **bold**, *italic* and links)
  - bulleted list and numbered list
  - quote
  - callout (note or tip)
  - code (plain monospace, with an optional language label)
  - image (an R2 upload with alt text and an optional caption)
  - divider
  - library-item embed (renders a card for another item, with the same visibility rules)
  - link card
- **Inline formatting** is stored as structured data or a tiny, strictly parsed markup inside text blocks. It is **rendered by our own JSX. No stored HTML, and no `dangerouslySetInnerHTML`.** Links must be `https://` or `mailto:`.
- **Validation:** with Zod, as in `src/lib/email/blocks.ts`. Library blocks drop the email merge-tag check. Recommended cap: 300 blocks per page.
- **Saving:** drafts autosave, debounced.
- **Read time** is computed from the word count.
- **Seeded frameworks** are built as blocks:
  - overview → text
  - "potential use cases" → bulleted list
  - the framework diagram → image (in R2)
  - read-more links → link cards
  - "CODErs who have used the framework" → a callout
- **Seeded website guides** are converted from the `ARTICLES` shape (sections, figures, components, questions, references) into blocks. Their placeholder figures are dropped.

## 12. Smart search (optional, never writes)

### 12.1 What the member sees

- **Keyword chips.** A member types a natural question such as "how do I get members to actually show up". Under the search box, up to 5 chips appear (for example Member Engagement · Motivation · Accountability). Chips that match existing tags filter by that tag. Others act as extra keywords. Tap a chip to remove it.
- **Meaning-based ranking**, merged with keyword results.
- **The Related shelf** (7.4).
- **A "Smart search" switch** in the search options. On by default, remembered per member (a member preference column or the existing preferences mechanism, builder's choice). Off means plain search only.
- **No chatbot, no sparkle icons, no "AI" badge, no generated sentences, ever, in this release.**

### 12.2 Pipeline

- **Bindings.** Add `AI` (Workers AI) and `VECTORIZE` (index `code-portal-beta-library`) to `wrangler.beta.jsonc` only. Staging and prod get them at release time.
- **Indexing** runs on publish, edit, restore and approve. It removes the item's vectors on takedown, delete or a switch to confidential.
  - Text extraction:
    - **File items:** `env.AI.toMarkdown()` for PDFs and `.docx`. It doesn't list `.pptx` or every Office format, so those get indexed by title, summary and tags only.
    - **Page items:** plain text from the blocks.
    - **Link items:** title plus description.
  - Chunk to roughly 500 tokens, embed with a multilingual model (4.2.16), and upsert to Vectorize with metadata `{ itemId, chunk }`.
  - Store the extracted text in D1 as well, so plain search (7.2) covers it.
  - Run this in the background. Publishing must never wait on it. Recommendation: `ctx.waitUntil` plus the admin rebuild button (12.2) as the catch-up path. Don't reuse the `EMAIL_JOBS` queue as-is: its consumer `queue()` in `custom-worker.ts` throws unless `FEATURE_EMAIL` is on, and it treats every message as an email job. A queue needs its own binding or type-based routing.
- **Querying:**
  1. **Keyword chips:** one call to a small instruct model, given the canonical tag list. It returns JSON only: up to 5 tags from the list plus up to 3 free keywords. Invalid output means no chips.
  2. Embed the query, take the top-K chunks from Vectorize, group them by item, fuse with the plain-search ranking (for example reciprocal-rank fusion), then **filter in D1** by status, confidentiality and permission.
- **Failure.** Any AI or Vectorize error or timeout (budget around 1.5 s) falls back silently to plain search. Chips simply don't appear.
- **Admin control.** A "Rebuild search index" button in the admin library page re-indexes in batches. It is used once after seeding (section 17).
- **Graph.** The "graph" part of GraphRAG comes from shared tags and frameworks boosting related items. A real knowledge graph is not in scope.
- **Privacy.** Content goes only to Cloudflare's Workers AI. No outside model provider is used.

## 13. Data model

The migration number goes after the current last one, `0011_email_personalization.sql`. **There is a known collision:** the event-feedback spec (`2026-10-16-event-feedback-design.md`) also claims `0012` and adds an `AI` binding to every wrangler config. Number this migration at build time after whichever lands first. If event-feedback lands first, reuse its `AI` binding rather than adding a second one. Follow `migrations-directory-driven`: the local runner reads the migrations directory.

### 13.1 `library_items` (alter)

Add:
- `format` (`file | page | link`, not null)
- `source` (`code | member | outside`)
- `status` (`draft | pending_review | published | taken_down`, not null, default `published` for existing rows)
- `contains_client_data` (boolean, nullable until answered)
- `moderation_reason` (text)
- `public_readiness` (nullable enum, 5.5)
- `subtype`, `format_detail`, `engagement_type` (text), `year` (integer)
- `authors_json`: an array of `{ name, memberId? }` objects, used for display and "Still in CODE" chips. A join table isn't needed, because authors grant no rights and search reads the flattened names.
- `file_key`, `file_name`, `file_type`, `file_bytes`
- `url`
- `blocks_json` (block array)
- `extracted_text` (text, for search)
- `client_data_redacted` (boolean, default false). When true, the item page shows a "Client details removed" note.
- `indexed_at` (timestamp)

Widen `LibraryKind` (5.2). `created_by` is the **owner** (call 18): nullable, set null on member delete, and the column every permission check uses. `published_at` becomes the first-published time and is null for drafts. Add indexes on `status`, `kind`, `source` and `published_at`.

Old columns (`category`, `sections_json`, `components_json`, `questions_json`, `references_json`, `topics_json`) are no longer used. They can be dropped with a table rebuild or left in place; builder's choice, but don't read from them anywhere.

### 13.2 New tables

- `library_tags(id, name unique, group_name, created_by, created_at)`
- `library_item_tags(item_id, tag_id)` with primary key on both, cascades, and an index on `tag_id`
- `library_list_members(list_id, member_id, role)`, where role is `editor` for now, with primary key on (list, member)
- `library_list_comments`, the same shape as `library_comments` but pointing at a list. Builder may instead generalize `library_comments`.
- `library_reports(id, item_id nullable, list_id nullable, member_id, reason, details, created_at, resolved_by, resolved_at, resolution)`
- `library_item_member_days(item_id, member_id, day, opens, active_seconds, downloads)` with primary key on (item, member, day) and indexes on `item_id` and `day`
- An FTS5 virtual table over title, summary, author, tags and extracted text (7.2), if FTS5 is chosen

### 13.3 `library_lists` (alter)

Add `description`, `shared` (boolean), `is_default` (Saved list), `pinned` (boolean), `pin_order` (integer), `taken_down_at` and `moderation_reason` (call 20), and `updated_at`. Keep `color`.

### 13.4 `library_list_items` (alter)

Add `note` (text), `added_by` (FK to `members`), `position` (integer). Rename-in-meaning `created_at` to "added at".

### 13.5 `library_favorites` (drop)

Migrate every row into the member's Saved list (creating it), then drop the table. Update `LibraryRepository` and the two pages that call `listFavorites`: `src/app/portal/library/[id]/page.tsx:33` and `src/app/portal/library/lists/page.tsx:22`. The dashboard's "From the library" card (`src/app/portal/page.tsx:37`) calls `listItems(actor, { limit: 3 })`, not favorites. It only needs to keep working with the new status filter.

## 14. Notifications

Sent through `notify()`, so they only appear when `FEATURE_NOTIFICATIONS` is on.

| Event | Recipient |
|---|---|
| Item approved, sent back, taken down or restored | Author |
| Added as an editor of a list | That member |
| New comment on my item, or on a list I own or edit | The item's owner, or the list's owner and editors (minus the commenter) |
| New item waiting for review, or new report | Holders of `library:moderate` |

## 15. Seed import

### 15.1 Hard rule: nothing from the sheet is committed

- The source files and data stay in **`.local/library-import/`**, which is gitignored (`.gitignore:54`). Today that folder holds 199 files (251 MB) plus `sheet.json`, `probe.tsv`, `pull.tsv` and `download.tsv`.
- The **import script** may be committed (for example `scripts/library-import.ts`). It must read only from `.local/` and write its outputs back to `.local/`: a manifest JSON, a seed SQL file and an upload plan.
- `src/db/seed/data.ts` keeps **synthetic** demo items for local development. It never holds real titles or names.
- **Before any `graphify update .`, confirm graphify ignores `.local/`.** Today's `graphify-out/manifest.json` has no `.local/` entries, which suggests it respects `.gitignore`, but verify it. Add an explicit ignore if graphify supports one.

### 15.2 Sources and counts

| Sheet tab | Rows | Becomes | Files in `.local/library-import/` |
|---|---|---|---|
| ⚙️ Document Data | 142 documents (+1 form link, skipped) | `code_document`, `format=file` | 135 (122 PDF, 11 Word, 2 more PDFs from the public pass). 7 missing: MOD-029, RES-001…RES-006 |
| ⚙️ External Library Data | about 51 rows | `reading`: 37 files, 3 IDEO pages as `link` | 37 PDFs. 5 missing. About 6 rows have no link (import them only if they have enough metadata to be useful) |
| ⚙️ Framework Data | 27 frameworks (`FMRW-001`…) | `framework`, `format=page` | 27 diagram images (PNG, JPEG, WebP) |
| 🔗 External Links | 4 (Toolshero, Mind Tools, World of Work, Untools) | `website`, `format=link` | — |
| `src/content/site.ts` `ARTICLES` | 3 | `guide`, `format=page` | — |
| Content Data (old) | 105 | skipped: every link is dead | — |

That comes to roughly **210 items**. Files are keyed in `.local/library-import/` by Drive file ID (`<tab>/<id>/<original name>` from rclone, or `<tab>/<id>` from the public pass). Recover the hyperlinks from `sheet.json` keys ending in `_url`. The sheet's display text is just a file name such as `IDF-001.pdf`.

### 15.3 Normalization

- **Document type:** "Module: SLE" becomes subtype `Module` plus format `SLE`. `IDF` and "IDF: Leadership Training Seminar" become `IDF`. "Topic Resource" stays `Topic Resource`.
- **Engagement type:** STE, LTE, C-Team ("C-team" becomes C-Team; "N/A" or empty become null).
- **Topics:** split on `,`, `;` and newlines, but rejoin known phrases that the split breaks (for example "Processes, Systems, and Structures (PSS)"). Then map through the raw-to-tag table in the manifest. Every raw topic must map to at least one tag or be explicitly dropped. The script fails if anything is unmapped.
- **Authors:** split the author cell on commas and newlines, giving a list of names (nickname plus last name in the sheet). External authors such as "Doe, Jane" are one name in "Last, First" form, so don't split those on the comma; split reading authors on newlines only. For each name, set `memberId` when it matches exactly one current portal member (case-insensitive) on `members.nickname` plus the last word of `members.full_name`, or on `members.name`. `members` has no given-name or last-name columns. Ambiguous or unmatched names keep only `name`. **Owner:** the matched member when exactly one author matched, otherwise null (call 18).
- **Titles:** IDF rows have no title in the sheet; their "Topic/s" field is the description. Title them `IDF-001: <first topic>` or similar (builder's call), keep the full topic text in the summary, and keep the file code (`IDF-001`, `MOD-046`) in the summary or a dedicated field so people can still search by code.
- **Status and visibility:** all `published`. `confidentiality` and `client_data_redacted` come from the client-data review (15.6): clean gives `members`, redacted gives `members` plus `client_data_redacted = true`, flagged gives `confidential`. `contains_client_data = false` for clean and redacted items, `true` for confidential ones. `public_readiness` is `not_eligible` for `reading` and `website`, null for everything else.
- **`created_by`:** see the owner rule above. The import writes one audit row attributed to CJ.

### 15.4 Files into R2

- **Key layout:** `library/<itemId>/<memberId>/<fileId>.<ext>`, the same pattern as event media.
- **Upload:** with `pnpm exec wrangler r2 object put code-nest-dev-uploads/<key> --file <path> --content-type <type> --remote`, one call per file, driven by the generated upload plan. Show CJ the exact command and the file count, and wait for approval before running it (project rule).
- **Images:** framework diagrams go into the same namespace and are referenced from image blocks.

### 15.5 D1

The script writes `.local/library-import/seed.sql`. It is applied with `pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --file .local/library-import/seed.sql`, **only after showing CJ the command and getting approval**. The same SQL also seeds the local SQLite for development, which may optionally use it.

### 15.6 Client-data review of the seed files (decision 17)

This runs locally, before anything is uploaded. All inputs, outputs and logs stay in `.local/library-import/`.

1. **Extract text.**
   - PDFs: Ghostscript (`gs -sDEVICE=txtwrite`, already installed) or PyMuPDF.
   - Word files: read `word/document.xml` from the `.docx` zip.
   - **A PDF with no extractable text** (a scan) can't be checked automatically, so it is marked `confidential`.
2. **Review each document.** Claude reads every document's text, in batches across subagents, and records:
   - a verdict: `clean`, `redact` or `confidential`
   - each client-data string found, with page numbers
   - a one-line reason
3. **What counts as client data:**
   - names of client organizations, other than as a generic example
   - names of client officers or members
   - diagnosis findings, survey results, interview quotes, or problems tied to a named client
   - contact details

   **What doesn't count:** CODE members' own names as authors or facilitators, CODE and Ateneo themselves, and generic organization-development content.
4. **Choose the verdict:**
   - `clean`: no client data.
   - `redact`: client data is limited to identifiers (names, contacts) that can be removed while keeping the document useful.
   - `confidential`: the substance *is* the client's private situation (for example a full diagnosis report), there's too much to redact safely, or the text can't be verified.
5. **Redact for real, not with black boxes drawn over text.**
   - PDFs: PyMuPDF `add_redact_annot` + `apply_redactions`, which removes the underlying text. Insert a replacement label such as `[Client org]` or `[Client member]`.
   - `.docx`: replace the strings in the XML.
   - Install PyMuPDF in a throwaway virtualenv for this tooling. It is never an app dependency.
6. **Verify.** Re-extract text from each redacted file and fail if any flagged string remains (case-insensitive). If verification fails, the document becomes `confidential` instead.
7. **What gets uploaded:**
   - Redacted copies only, for redacted documents.
   - Originals stay in `.local/` (and in Drive). They are never uploaded.
   - Confidential documents upload their original file, visible only to `library:manage`.
8. **Report to CJ before seeding:** counts per verdict, the full confidential list with reasons, and a sample of redactions to spot-check. TRD repeats the spot-check during the soak.

The review log (strings found, verdicts) is sensitive and stays in `.local/`. It is never committed.

## 16. Uploads and storage

- **New purposes in `uploads.ts` and `contract/uploads.ts`:**
  - `library_file`: PDF, DOCX, PPTX and XLSX, up to **50 MB**.
  - `library_image`: GIF, JPEG, PNG and WebP, up to 10 MB.
  - Both require an `itemId` the actor can edit: its owner or a `library:moderate` holder (call 19).
- **Size limit.** `MAX_MULTIPART_BYTES` becomes per-purpose. The 5 MB limit stays for the existing purposes.
- **Per-object access check.** `parseNamespace` learns `library/<itemId>/<memberId>/<file>`. GET calls a new dependency, `canReadLibraryObject(actor, itemId)`, which applies the same rule as the item page: published and not confidential (or the actor holds `library:manage`), or the actor is the owner or a moderator. `createUploadHandlers` is built in **three** places: `src/app/api/uploads/route.ts`, `src/app/api/uploads/[key]/route.ts`, and the shared-dev `src/server/internal/uploads.ts` (live on beta because `DEPLOY_ENV=dev`). Wire the new dependency into all three. This closes the "signed-in only" gap for library files.
- **Response headers:** `Content-Type`, `Content-Length`, and `Content-Disposition` (`inline` for PDF and images, `attachment` for Office files, or when `?download=1` is set) with the stored `file_name`. Range-request support for large PDFs is recommended, not required.
- **Upload size limit.** Library uploads go through the existing route handler, not a server action, so Next's 1 MB server-action body limit doesn't apply. Workers allows request bodies up to 100 MB on this plan.
- **Orphans.** If a member uploads and then abandons the draft, the file stays in R2. This is acceptable for now. Leave a `ponytail:` comment noting that a cleanup job should sweep unreferenced `library/` keys later.
- **Do not copy the `eventMedia` pattern** that trusts a client-sent `r2Key`. The item's `file_key` is set by the server from the upload result for that same item.

## 17. Permissions and flags

| Capability | Who |
|---|---|
| Read published `members` items, use lists, comment, report | Any signed-in member (`FEATURE_LIBRARY` on) |
| Create items, edit own items, publish own drafts | Any signed-in member (no delete, no unpublish) |
| Approve, send back, take down, restore, set public readiness, retag any item, manage tags, pin collections, hide comments, resolve reports | `library:moderate` |
| Everything above, plus confidentiality, delete any item (quietly, 6.3), rebuild the index | `library:manage` |

Both permissions stay on the `publishing` role. In the UI, "library moderators" means holders of `library:moderate`.

**Flags:**
- `FEATURE_LIBRARY`: already on in beta.
- **New** `FEATURE_LIBRARY_SMART_SEARCH`: fails closed. Turn it on in beta only after the bindings exist. Register it in `src/server/env.ts` and `src/server/features.ts` like the others.

`APP_ENV=shared` keeps using `createUnavailableLibraryRepository`. Local preview uses local SQLite (see the local signed-in preview recipe).

## 18. Rollout

Beta only in this release. Every `wrangler` command that touches D1, R2 or Vectorize is shown to CJ first, and run only after approval.

1. Land the code on `beta`. Beta auto-deploys through Workers Builds on push. Migrations stay manual.
2. Apply migrations in order: event feedback's `0012` first, then this feature's migration. Both use `pnpm db:migrate:beta`, which runs `wrangler d1 migrations apply DB --config wrangler.beta.jsonc --remote`.
3. Create the Vectorize index: `pnpm exec wrangler vectorize create code-portal-beta-library --dimensions=<model dims> --metric=cosine`. Add the `AI` and `VECTORIZE` bindings to `wrangler.beta.jsonc` and redeploy.
4. Run the import script and the client-data review (15.6) locally. CJ reviews the tag mapping, the counts, the confidential list and a sample of redactions.
5. Upload the files to R2 (15.4), then apply the seed SQL to D1 (15.5).
6. Click "Rebuild search index", then turn on `FEATURE_LIBRARY_SMART_SEARCH` for beta.
7. **Soak.** The release bar for production:
   - The TRD head plus about 5 module writers use it for one real engagement prep.
   - All seeded documents open.
   - No broken uploads or saves.
   - Hours and save counts look sane.
   - TRD spot-checks a sample of the redacted documents, and the confidential list, for anything the review missed or over-flagged.
8. **Production** is a separate, later pass with its own migration, Vectorize index, R2 upload, seed and flag flip, all with approval. Check `prod-runs-beta-lineage` and `migration-lineage-split` before touching it.

## 19. Testing

All tests run in the Workers vitest pool: `.ts` only, no jsdom, no render tests, no better-sqlite3 import.

- **Repository:**
  - Status transitions and who may make each one. Members can't delete or unpublish. An admin delete removes list entries quietly.
  - Visibility for drafts, pending, taken-down and confidential items, across items, lists, Related, counts and search.
  - Save counting (distinct members, Saved-list migration).
  - Activity clamping and the daily cap.
  - Tag merge retagging every affected item.
  - List roles and sharing.
  - Comment visibility checks.
- **Uploads:** parsing the `library/` namespace, per-purpose limits and types, `canReadLibraryObject`, and the response headers.
- **Search:** SQL filtering across more than 100 items (a regression test for today's bug), and fallback when the AI call throws.
- **Client-data redaction tooling:** the verify step (no flagged string survives) tested on a small synthetic PDF and `.docx`. Never use a real seed file as a test fixture.
- **Import script:** normalization functions (doc type, engagement type, topic split and mapping, author match) tested on small inline fixtures, never real sheet data.
- **E2E (Playwright, existing `e2e/` setup):** upload → publish → appears in search. Client-data upload → pending → approve. Save to a list → share → a second member comments. Run the mobile viewport too, and apply `min-w-0` with `break-all` to user-controlled labels.

## 20. Left to the builder

- Exact Drizzle schema, migration SQL, and whether to drop the old columns.
- FTS5 versus `LIKE` (7.2).
- How the block editor is shared or forked, and how inline formatting is stored.
- The embedding and instruct model IDs, chunk size, top-K, fusion weights and timeouts.
- Where the smart-search preference is stored.
- Page and component structure, and moving the old admin create/edit form into the shared editor. The admin library page becomes the moderation queue (pending, reports, taken down), tag management, and the index rebuild.
- Notification copy, and the first draft of the pitch copy.
- How downloads are counted (10.1).

## 21. Later (explicitly deferred)

- Who sees "S7 confidential", and what goes there.
- Going public: merging `/product` with public-ready library items, slugs, the public renderer, and whether `article_feedback` carries over.
- Engagement Planning Pages (team boards).
- Written AI answers with sources.
- PDF highlights and annotations.
- Converting Word files to PDF.
- A member directory and "message the author".
- Recovering the 7 internal and 5 external missing files, and any copies of the 105 old modules that TRD can still find.
- Cleaning up orphaned uploads.
- rclone's shared Google client ID stops working later in 2026. Future re-pulls need CJ's own client ID, or the Drive web UI.

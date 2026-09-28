# Slice: Shortlinks QR and Analytics

Status: approved

## Evidence

- Approved direction: Incremental task-first links workspace with QR composition B and report-first analytics.
- Prototype/screenshot ID: `ARSA-QR-INTEGRATED-DESKTOP`, `ARSA-QR-INTEGRATED-MOBILE`
- Mobbin reference IDs: M01, M02, M03, M04, M05

## Scope

- User-visible outcome: A member can open Details accessibly, customize and save a CODE QR style, export only verified QR output, and read statistics from one explicit, consistently applied query.
- Files/components in scope: `src/components/links/*`; `/portal/links` pages; links repository, contracts, handlers, redirect and shared/internal adapters; related authorized upload adapters; focused unit, integration, and E2E checks.
- Explicitly out of scope: Schema changes, database reset/migration/seed, deployment, merge, push, raw click logs, historical backfill, fabricated referrers or bots, physical-camera certification, and unrelated routes/modules.
- Behavior to preserve: Search, sorting, tags, owners, creation, editing, moderation, social previews, sharing, fullscreen, audit logs, saved QR styles, public `/<slug>` routing, untagged copied URLs, stored `qr scan`/`direct` buckets, owner and `link:moderate` authority, super inheritance, member read/create access, and shared-dev read-only mutations.

## Acceptance checks

- [x] Non-interactive row space and a semantic title button open Details; child and portaled controls do not. Escape closes and restores focus; targets are at least 44px.
- [x] QR supports Classic, Rounded, Dots, Soft, Classy, and Classy rounded, appropriate corner choices, logo show/choice, optional circle/square backing and backing color, five calibrated logo sizes defaulting to step 3, navy/white swap, and light/dark/transparent export backgrounds.
- [x] Preview, PNG, and self-contained SVG use the same unchanged official/custom artwork at 512, 1024, and 2048px. H correction and quiet space remain.
- [x] Exact final PNG and rasterized SVG decode at full size and 256px before either download is enabled. Pending, failure, stale work, failed upload, and insufficient contrast block unsafe output with recovery guidance.
- [x] Old and new saved styles parse, validate, serialize, and stay isolated per link. Preview and download never silently save.
- [x] New QR URLs use `source=qr`; legacy `s=qr` remains accepted. Canonical precedence, duplicates, conflicts, invalid markers, bare links, destination queries, and crawler previews are tested without leakage or double counting.
- [x] One validated query applies dates, timezone, hour/day/week/month grouping, source, and device to metrics, trend, and breakdowns. Applied filters, reset, counts/percentages, zero buckets, lifetime versus available history, and explicit row/bucket limits are visible.
- [x] Matching skeletons retain identity and controls. Empty, error, retry, unavailable-history, and narrowed-query guidance are distinct.
- [x] Owner, moderator, super, unrelated role, anonymous, forged owner, and shared-dev access are verified for link and related upload paths.
- [x] Integrated layouts at 320px, 390x844, 1280x720, and 1280x800 have no horizontal overflow; keyboard, visible focus, contrast, and reduced motion are checked.
- [x] Focused tests, full `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass or baseline failures are separated from regressions.
- [x] No migration, seed, reset, deployment, merge, or push is performed. Any later Worker command is shown for separate approval.

## Rollback boundary

The feature branch and this single slice are the rollback boundary. Revert its UI, contract, repository, and adapter changes together; no data rollback is required because no schema or production operation is included.

## Human Gate 4

- Decision: approved for implementation and review
- Approved by: human
- Date: 2026-09-16
- Comments: Implement, test and independently review the approved slice.

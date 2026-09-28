# Slice: Short-link focused polish

Status: approved, Human Gate 4

## Evidence

- Approved direction: focused polish, 2026-09-28.
- Prototype IDs: `LINKS-A-DESKTOP`, `LINKS-A-MOBILE`.
- Mobbin reference IDs: L01, L02.

## Scope

- User-visible outcome: short URL and Copy/QR actions are visible on mobile; create starts with destination; detail leads with the short URL; QR styling is collapsed; zero-click ranges explain their state; link counts match filters.
- Files/components in scope: `links-workspace.tsx`, `styled-link-qr.tsx`, focused component check.
- Explicitly out of scope: short-link API, permission policy, stored QR style, redirect behavior, and database.
- Behavior to preserve: `slug`, `destinationUrl`, `title`, `tags`, preview fields, `qrStyle`, `/<slug>` targets, `?source=qr`, `limit`/`offset`, statistics query names and enum values, click totals, referrer/device buckets, owner and moderator rights.

## Acceptance checks

- [x] Matches approved prototype A.
- [x] Mobile viewport checked at 390 x 844 with no page overflow.
- [x] Desktop viewport checked at 1280 x 800 with no page overflow.
- [x] Dialog focus and form order checked; native QR disclosure remains keyboard operable.
- [x] Uses existing contrast tokens and reduced-motion behavior.
- [x] Final lint, typecheck, focused component test, and OpenNext build pass after implementation. Lint reports 152 existing warnings and no errors.
- [x] Independent review findings fixed: mobile Delete restored and empty-range history wording corrected. The temporary live-component preview route was removed to avoid fake actions calling the API.

## Rollback boundary

- Revert only the link UI files and focused check; no schema, API, or seed changes.

## Human Gate 4

- Decision: approved.
- Approved by: user.
- Date: 2026-09-28.
- Comments, verbatim: "Approve short links and continue calendar (Recommended)".

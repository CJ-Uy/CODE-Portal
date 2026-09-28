# Member links UI brief

Status: approved scope, design pending
Owner: human
Date: 2026-09-28

## User and journey

- Primary user: CODE member sharing an official link; moderator can manage any link.
- Start: `/portal/links` on desktop or phone.
- End: create, find, copy, inspect, or export a link without losing context.
- Current pain: mobile table hides essential actions behind a wide horizontal scroll; detail view gives advanced QR settings priority over common tasks.

## Desired outcome

- User outcome: short URL and copy action are immediately visible; QR export and click totals are easy to find; editing stays scoped to owners and moderators.
- CODE impression: calm, trustworthy, compact.
- Success signal: no page overflow at 390 and 1280 px; a member can reach copy, QR, and statistics without sideways scrolling; counts match active filters.

## Constraints

- Preserve `/<slug>`, owner and moderator permissions, search, tags, sorting, QR style and export, link statistics, and existing form/API names.
- Use CODE palette, Unna, Source Sans, existing tokens and UI primitives. Keep official logo intact.
- Keyboard focus, useful status text, contrast, touch targets, and reduced motion remain intact.
- Beta UI matches the `feature/shortlinks-qr-analytics` worktree more closely than current `beta` checkout. Verify the deploy source before implementation.

## Non-goals

- No new analytics buckets, bulk tools, schema, or link permissions.
- No production deploy or D1 operation in this review.

## Human Gate 1

- Decision: links journey and beta audit requested directly by user.
- Approved by: user, 2026-09-28.
- Comments: focus on improving link shortener.

# Slice: Calendar time sections

Status: approved, Human Gate 4

## Evidence

- Approved direction: date sections, 2026-09-28.
- Prototype IDs: `CAL-A-DESKTOP`, `CAL-A-MOBILE`.
- Mobbin reference IDs: C01, C02, C03.

## Scope

- User-visible outcome: List shows Today, Upcoming, then Past in separate event rows. Current and future events ascend by start time; past events show most recent first. Role cues remain in rows. A past detail page makes its timing clear.
- Files in scope: calendar list, list loader, event detail, and one focused check.
- Data load: page through the existing published-events contract so old records cannot hide future events after the first 50.
- Out of scope: attendance, signup policy, permissions, event schema, and month-grid behavior.
- Preserve: UTC+8 date boundaries, inclusive end dates, role badges, event detail links, points controls, event types, and the existing shared-access contract.

## Acceptance checks

- [x] Today includes events spanning the current UTC+8 day; Past sorts by last activity.
- [x] More than 50 older events do not hide a future event.
- [x] Empty and failed loads have accurate copy.
- [x] Mobile at 390 x 844 and desktop at 1280 x 800 have no page overflow.
- [x] Lint, focused check, typecheck, and OpenNext build pass. Lint has 152 existing warnings and no errors.
- [x] Independent read-only review completed. Misleading past check-in copy was fixed; shared-mode limitation is documented below.

## Known limitation

- Shared development mode already exposes no calendar event-list repository. This slice changes its misleading empty state to a load error. The existing `/internal/events` contract omits some list fields, so shared parity needs a separate backend and adapter slice with Worker redeployment.

## Rollback boundary

- Revert only the calendar list, loader, detail copy, and focused check. No schema or Worker changes.

## Human Gate 4

- Decision: approved.
- Approved by: user.
- Date: 2026-09-28.
- Comments, verbatim: "Approve calendar slice and prepare beta integration (Recommended)".

# Member links decisions

## 2026-09-28, Human Gate 2

- Status: approved.
- Decision: Direction A, focused polish. Keep desktop table; show compact mobile rows with visible short URL, Copy, QR, and clicks. Simplify detail hierarchy, collapse advanced QR settings, and explain empty statistics.
- Human comment, verbatim: “yeh so I agree with all your recommendations continue”
- Evidence: `02-codex-audit.md`, `03-mobbin-references.md`, `04-directions.md`.
- Next gate: show responsive, fake-data prototype before production UI edits.

## 2026-09-28, Human Gate 3 candidates

- Status: proposed, awaiting variant choice.
- `LINKS-A-DESKTOP` / `LINKS-A-MOBILE`: balanced table on desktop, direct action rows on mobile. `/design-lab/links-calendar/a#links`.
- `LINKS-B-DESKTOP` / `LINKS-B-MOBILE`: short URL-led compact list at both sizes. `/design-lab/links-calendar/b#links`.
- Both show the simplified selected-link hierarchy, collapsed QR options, and an empty-range statistics explanation.
- Visual check: 390 x 844 and 1280 x 800; no page-level horizontal overflow.

## 2026-09-28, Human Gate 3

- Status: approved.
- Chosen prototype: `LINKS-A-DESKTOP` and `LINKS-A-MOBILE`.
- Human comment, verbatim: "A · Balanced table and mobile rows (recommended)".
- Reference: `/design-lab/links-calendar/a#links` in the `links-calendar-prototypes` worktree.
- Next gate: review the implemented short-link slice before the next slice or a beta deployment.

## 2026-09-28, Human Gate 4

- Status: approved.
- Decision: short-link implementation slice approved; continue with calendar.
- Human comment, verbatim: "Approve short links and continue calendar (Recommended)".
- Evidence: `slices/01-focused-polish.md`, implementation commit `90c308d`.
- Prototype source is preserved in commit `3d16431`; the fake-data route was removed before beta integration.

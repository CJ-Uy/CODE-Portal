# Calendar list decisions

## 2026-09-28, Human Gate 2

- Status: approved.
- Decision: Direction A, date sections ordered Today, Upcoming, Past. Keep role cues in each row; sort today and upcoming ascending, past descending. Address the first-50-events fetch risk in implementation.
- Human comment, verbatim: “yeh so I agree with all your recommendations continue”
- Evidence: `02-codex-audit.md`, `03-mobbin-references.md`, `04-directions.md`.
- Next gate: show responsive, fake-data prototype before production UI edits.

## 2026-09-28, Human Gate 3 candidates

- Status: proposed, awaiting variant choice.
- `CAL-A-DESKTOP` / `CAL-A-MOBILE`: individually separated event rows. `/design-lab/links-calendar/a#calendar`.
- `CAL-B-DESKTOP` / `CAL-B-MOBILE`: compact rows joined within each date section. `/design-lab/links-calendar/b#calendar`.
- Both show Today, Upcoming, Past, with role badges on each event.
- Visual check: 390 x 844 and 1280 x 800; no page-level horizontal overflow.

## 2026-09-28, Human Gate 3

- Status: approved.
- Chosen prototype: `CAL-A-DESKTOP` and `CAL-A-MOBILE`.
- Human comment, verbatim: "A · Separate event rows (recommended)".
- Reference: `/design-lab/links-calendar/a#calendar` in the `links-calendar-prototypes` worktree.
- Next gate: review the implemented calendar slice before a beta deployment.

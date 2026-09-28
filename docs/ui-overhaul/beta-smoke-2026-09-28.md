# Beta UI smoke audit

Date: 2026-09-28
Status: read-only review; design selection pending
Environment: `https://beta.ateneocode.org`, authenticated member with link moderator access.

| Surface | Desktop | 390 x 844 mobile | Finding |
| --- | --- | --- | --- |
| Public home | Hero, navigation, Product Center links render. | Hero fits; body has no horizontal overflow. | Top navigation uses a visible horizontal scrollbar. Lower-priority polish. |
| Member overview | Summary, retention, announcements, library render. | Cards stack cleanly; body has no horizontal overflow. | No blocking visual issue in this smoke check. |
| Short links | List, create dialog, QR, statistics render. | Table scrolls horizontally; 1037 px table in 341 px scroll area. | Copy, QR, and click data are offscreen. Filter footer and empty state contradict visible results. See `member-links/02-codex-audit.md`. |
| Calendar | Month, List, event detail render. | List rows fit and detail opens. | List groups by ownership, not date; past detail still leads with signup and check-in. See `calendar-list/02-codex-audit.md`. |

Research: Mobbin Dub links and creation, Luma Events, Calendly Calendar, and Circle Events. Source links and patterns are in each journey's `03-mobbin-references.md`.

Verification: feature worktree at `40fe213` passed `pnpm typecheck` and targeted ESLint for links and calendar files. Full `pnpm lint` failed on generated `.open-next-stale-verification` and other unrelated worktree files, reporting 2364 errors and 18602 warnings. No build was run, so local build status is unverified. Beta screens were inspected directly. No create, edit, delete, signup, check-in, D1, or deploy action was run.

Next: select the proposed link and calendar directions, inspect responsive prototypes, then apply approved slices and run lint, build, and overflow checks. The deployed SHA is not exposed by the beta UI; implementation should start from the feature worktree that matches the observed link screens, after confirming its base.

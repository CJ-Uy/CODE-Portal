# Code Portal feature review, 28 October 2026

Reviewed the October 23 beta batch: gallery, feedback and retention points, Important links, spreadsheet mail merge, library browsing and editing, loading feedback, and member pages. The review assumed normal shared use by members and officers, including rosters of more than 100 members.

## Fixed

- **Gallery sharing permissions:** moving a private album into a public album could publish its existing photos without the gallery admin permission. Moving an album now checks changes to inherited public visibility in either direction. Members can still organize albums when visibility stays the same.
- **Feedback points after a corrected check-in:** undoing a check-in correctly removed its points, but recording it again did not restore the share already earned by answering the feedback form. The scan now restores that share in the same atomic database write.
- **Feedback points after award edits:** changing a completed event award to zero, 0.01, or a negative value left the old positive feedback share behind. The shared award query now reconciles signed remainders and updates existing shares to zero when needed. It still avoids adding zero-value shares for members paid in full before the form existed.
- **Retention reports for larger rosters:** a 120-member progress request exceeded D1's 100-parameter limit. Record and pending-share reads now use batches of 80 member IDs, while loading the school year and point types only once.
- **Quoted CSV headers:** punctuation inside a quoted heading could make mail merge choose the wrong delimiter. Delimiter detection now ignores quoted text and escaped quotes.
- **Lint scope:** old worktrees and generated Playwright scratch scripts were included in the app lint scan. They are now ignored.

Eight regression cases failed against the original code and passed after the fixes. The existing browser tests were also updated for collapsed event options, the 12-slot retention view, repeated library links, inline note creation and autosave, and the visible pending indicator.

## Verification

| Check | Result |
| --- | --- |
| `pnpm test` | 1,822 worker tests and 15 component tests passed |
| Chromium browser suite | All 24 tests passed |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed, with 153 existing warnings and no errors |
| `pnpm build` | Next.js and OpenNext Cloudflare packaging passed |
| Mobile and desktop overflow | Browser tests passed, including widths from 320 to 1440 pixels |
| Local gallery browser check | Album creation, photo upload, heart, deletion and restoration worked |
| Additional layout checks | Gallery, Important links and the email composer fit at 320 and 1440 pixels |
| Independent review | No further actionable findings in the fixes and their immediate callers |
| Graphify | AST graph refreshed |

The email composer initially failed in the temporary browser environment because its required email settings were missing. Supplying test-only settings resolved it; application configuration validation was kept intact.

## Limits

Browser checks used a separate local SQLite database and test sign-in. No deployment, remote D1 change, historical point backfill, real email send, or live R2 upload was performed. The source fixes are local and uncommitted. This review does not establish that every possible portal workflow is free of bugs.

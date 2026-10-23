# Portal performance

Measured 2026-10-23 on the `claude/speed-loading-a1d85e` branch, before and after the speed and loading-feedback pass.

## What makes a portal page slow

Every portal page is `force-dynamic` and reads D1 from the Worker. Each awaited query is a full round trip from the Worker's colo to the D1 primary, so the number that matters is how many queries run **one after another** (serial waves), not how many run in total. Queries inside one `Promise.all` share a wave.

Before this pass the common costs were:

- **Auth ran three serial queries and ran several times per request.** `auth()` read the session joined to the member, then the session callback re-read the member, then read the roles. The portal layout, a nested layout (admin), the page and each Suspense child all called `getActor()`, and each call repeated the chain.
- **Repository methods awaited independent reads in series.** For example `overview.getSummary` (five reads), `calendar.getMonth` (four), `calendar.getEvent` (five), `loadRetentionPickers` (four, on six admin pages), `termEventSummaries` (four), and the survey eligibility check (up to six).
- **An N+1 in `events.listPublished`.** For a member who is not an events moderator, every listed event ran its own staff-role query. Home lists up to 100 events and the calendar list view pages through all of them, so a member could trigger 100+ extra queries per page.
- **Admin filter forms were native GET forms**, so every filter change reloaded the whole document and re-ran the portal layout.
- **The portal shell bundled `qrcode` on every page** for a QR card that only appears in the mobile quick-actions sheet, and the scanner bundled `jsqr` even where the browser's own BarcodeDetector is used.

## Measurements

Local dev servers with the seeded preview database and a simulated 50 ms D1 round trip on every query (an async proxy over better-sqlite3 that waits before each query; the harness is not committed), signed in through the E2E bypass. Serial waves are counted from the query log: a new wave starts when the gap since the previous query start is longer than 30 ms.

Both builds ran side by side: the baseline (`85f0912`, where this branch starts) and this branch, each on its own dev server and its own copy of the database, with requests alternating between them. Wall time is the median of 7 full-page requests per route after two warm-ups.

### Super admin

| Route | ms before | ms after | Waves before | Waves after | Queries before | Queries after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/portal` | 861 | 429 | 8 | 3 | 21 | 17 |
| `/portal/calendar` | 1068 | 525 | 9 | 2 | 19 | 12 |
| `/portal/calendar?view=list` | 699 | 470 | 6 | 2 | 16 | 9 |
| `/portal/calendar/[eventId]` | 1113 | 692 | 11 | 6 | 39 | 38 |
| `/portal/retention` | 1107 | 686 | 10 | 7 | 17 | 13 |
| `/portal/library` | 432 | 346 | 5 | 3 | 18 | 14 |
| `/portal/links` | 558 | 431 | 4 | 2 | 13 | 9 |
| `/portal/surveys/[id]` | 594 | 455 | 6 | 3 | 13 | 13 |
| `/portal/admin` | 628 | 559 | 4 | 2 | 14 | 7 |
| `/portal/admin/content/surveys/[id]` | 784 | 681 | 9 | 6 | 22 | 15 |
| `/portal/admin/data/events` | 1069 | 708 | 13 | 6 | 26 | 19 |

### Plain member

| Route | ms before | ms after | Waves before | Waves after | Queries before | Queries after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/portal` | 779 | 490 | 8 | 3 | 24 | 18 |
| `/portal/calendar` | 800 | 448 | 9 | 2 | 19 | 12 |
| `/portal/calendar?view=list` | 712 | 486 | 7 | 2 | 19 | 10 |
| `/portal/calendar/[eventId]` | 1100 | 641 | 13 | 5 | 25 | 22 |
| `/portal/retention` | 1029 | 798 | 10 | 7 | 17 | 13 |
| `/portal/library` | 554 | 499 | 5 | 3 | 18 | 14 |
| `/portal/links` | 623 | 559 | 4 | 2 | 13 | 9 |
| `/portal/surveys/[id]` | 853 | 514 | 9 | 3 | 16 | 13 |

Every saved wave is one D1 round trip saved in production, so on beta the gain per page is roughly (waves saved) times the Worker-to-D1 round trip, on top of what the table shows. The seed has only three events, so the old N+1 shows as two or three extra queries here; on beta it grew with the number of events.

### Client JavaScript per route

Production `next build --webpack` of both trees. Gzipped size of the root chunks plus every chunk the route's client components need (lazy `import()` chunks excluded, since they load on use).

| Route | KB before | KB after |
| --- | ---: | ---: |
| `/portal` | 253.8 | 202.4 |
| `/portal/calendar` | 265.2 | 214.6 |
| `/portal/calendar/[eventId]` | 293.4 | 243.9 |
| `/portal/retention` | 261.0 | 210.5 |
| `/portal/library` | 262.2 | 211.5 |
| `/portal/links` | 279.5 | 274.3 |
| `/portal/surveys/[id]` | 253.8 | 202.4 |
| `/portal/admin` | 257.9 | 207.3 |
| `/portal/admin/content/surveys/[id]` | 291.2 | 242.2 |
| `/portal/admin/data/events` | 265.6 | 218.9 |

The drop is `qrcode` and `jsqr` leaving the initial load. The links page keeps its own QR styling library, so it gains least. The "after" figures already include the new submit button and progress bar; the skeletons are server components and ship no JavaScript.

The remaining waves on the event page, the points page and the admin survey page are page-level chains in files other sessions own. They are listed in the hand-over notes for those sessions.

## What changed

- `getActor()` is wrapped in React `cache`, so it runs once per server render.
- `src/auth.ts`: the adapter's `getSessionAndUser` reads the roles beside the session (keyed on the session token), and the session callback reuses the member row the adapter already joined. One round trip per request instead of three. Missing role keys fail closed to a plain member.
- Independent repository reads now go out together (`Promise.all`). No query changed shape. `events.listPublished` reads the viewer's staff rows once instead of once per event.
- Admin data filters use `next/form`, so a filter change is a client navigation.
- `qrcode` loads when a QR is first drawn, and `jsqr` loads only when the browser has no BarcodeDetector.

## Caching decision

No KV namespace or Durable Object was added. After the changes above, the read-mostly, non-personal data that could be cached (nav pins, quick links, point types, event types, terms) always runs in parallel with a per-member query in the same wave. Caching it would cut query count but not a single round trip, and it would add invalidation and a binding to manage. The largest fixed cost left is the database-session lookup itself (one round trip per request). Moving Auth.js to JWT sessions would remove it, but role changes and deactivation would then wait for the token to refresh, so it was not done.

## Loading feedback

- Every portal and admin section has a `loading.tsx` that mirrors its page's layout, built from `src/components/ui/skeleton.tsx`. Screens ease in after 80 ms, so a fast page never flashes one. Pulse animation stops under reduced motion.
- `src/components/portal/navigation-progress.tsx` shows a thin top bar for any same-origin link click or GET form submit. It appears only after 150 ms, fills and fades when the URL changes, and keeps its fade but drops its growth under reduced motion. It matters most for query-only changes (tabs, filters, month arrows), where `loading.tsx` does not re-trigger.
- `Button type="submit"` renders `src/components/ui/submit-button.tsx`. In a form whose action is a server action, the button disables while pending, swaps its icon for a spinner and changes a known leading verb ("Save changes" to "Saving changes…", list in `src/lib/pending-label.ts`). The pending state lasts through a redirect until the next page paints.

## Re-measuring

Count serial waves, not wall time, when comparing changes locally: dev-mode render time varies by tens of milliseconds between runs, while each wave costs a full D1 round trip in production.

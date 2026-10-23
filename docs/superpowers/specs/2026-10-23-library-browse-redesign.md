# Library browse redesign: audit, decisions and checks

Date: 2026-10-23. Branch: `claude/library-scroll-e06b19`.

CJ's brief: the library works but feels overwhelming and easy to get lost in. Show the latest items, then everything as one sheet that keeps scrolling, with no Next/Previous paging. Simplify search and filters, and keep every library v2 ruling (access levels, moderation, lists, block editor, tags, smart search).

Screenshots, before and after, at 1440 px and 390 px, are in the side-session notes folder:
`C:\Users\charl\AppData\Roaming\Claude\side-session-notes\local_fdf3e589-62db-4f00-9eae-6ce53e2d1f41\library-scroll\before\` and `...\after\`.
Each folder has one file per page: `home`, `search`, `item`, `lists`, `list`, `mine`, `new`, `edit` and `about`, each as `-desktop.png` and `-390.png`. They were taken signed in as a regular member, on a local copy of the 209 beta items.

## 1. Audit: what made it overwhelming

Two separate reviews ran: a design review, and the Impeccable detector with a browser overlay. The design review scored the old library 22 out of 40 on Nielsen's heuristics. It passed 2 of 8 cognitive-load checks.

1. **Eight blocks competed before the catalogue.** The page stacked header buttons, a pitch banner, the search box, a filter rail that was always open, Collections, Most saved this term, a reading-hours strip, then 8 recent items. At 1440 px only three item cards were partly visible. At 390 px no item was visible at all, because the banner alone took about 26% of the screen.
2. **Too many controls before the member had asked anything.** There were about 26 library controls above the fold on desktop and about 37 tab stops before the first card, from 8 type chips, 3 source chips, 7 tag groups and 5 header routes.
3. **The same items appeared twice.** Most saved and Recently added showed the same six items. The full catalogue was 9 pages of 24 behind Next.
4. **Back lost the member.** "Back to library" was a hard link, so it dropped the search, the filters and the page. Six pages each used a different back-link style, and two pages had none.
5. **The names overlapped.** "My library", "My lists", "Lists" and "Collections" were four overlapping terms. "Member workspace" eyebrows appeared on some pages only.
6. **Cards were noisy.** Type, source and tags looked like the clickable filter chips but did nothing. A screen reader heard the whole card as the link name before the title.
7. **Detector results.**
   - The only CLI finding is the pull quote's `border-l-4` in `library-blocks.tsx`. A left rule on a quote is a typographic convention, so it stays.
   - The overlay flagged over-long intro lines and cards flush against the scroller edge. Both are fixed.
8. **A bug outside the library.** `src/app/globals.css` has two rules outside any `@layer`: `* { border-color }` and `h1-h4 { font-family }`. Unlayered CSS beats every Tailwind utility, so each `border-primary`, `hover:border-accent`, `border-transparent` and `font-sans`-on-a-heading across the app silently does nothing. Library code works around it with Tailwind's `!` suffix. The real fix is a follow-up (see section 4).

## 2. Decisions

1. **Browse opens on Latest, then All items.**
   - Latest shows the four newest items as compact cards.
   - All items lists every item the member can see as one sheet that loads 24 rows at a time while they scroll. There is no paging anywhere. This is CJ's brief.
2. **All items is A to Z by default.**
   - With a query, it sorts by relevance.
   - Without one, it sorts by title. Sorting by newest would repeat Latest's four items at the top of the list, and a title order stays put like a sheet.
   - Newest is one tap away: Latest's "All items, newest first" link, or Sort. Sort also offers Most saved and Most read.
3. **Pagination uses a keyset cursor in the repository, not an offset.**
   - Every order ends with the item id, so no two rows tie.
   - The cursor holds the order's name and the last row's key values.
   - An item published between loads never shows a row twice or skips one.
   - A cursor that comes from another order, or is malformed, is refused with "reload".
4. **Each load still counts the total.** That is one extra query, run in parallel, and a `ponytail:` note in the repository marks it: skip the count on cursor loads if D1 time ever shows it.
5. **Smart search results arrive in one load.** There are at most 50 and no Load more. Paging would rerun the model calls for every page.
6. **The old `?page=` parameter is ignored.** Old links open at the top of the list.
7. **More rows come from a server action, `loadMoreLibraryAction`.**
   - It re-reads the page's own query string, using the same parser the page uses.
   - Visibility is still decided by the repository, so permissions are unchanged.
   - It returns `toCardFields` only, so no member ids reach the client.
8. **The list remembers where the member left it.**
   - It keeps the search, the rows loaded and the scroll position in sessionStorage, for this tab only.
   - The memory lasts 30 minutes and holds at most 600 rows.
   - It restores on Back or Forward, and when the member uses the breadcrumb's Library link. It does not restore on a fresh visit from the sidebar.
9. **The breadcrumb's Library link acts as a real Back** when the member came straight from the list, so history stays tidy. A tab that was opened directly does not go back to nowhere.
10. **Filters are reduced to a few visible ones.**
    - Type chips stay in the open, and only types that have items appear, plus All types. A chip never leads to an empty list.
    - Everything else moves behind More filters, an inline panel: source, tags, the module facets and the smart search switch.
    - Each filter that is on but hidden shows as a removable pill.
    - One "Clear search and filters" undoes it all.
    - The always-open filter rail and the phone filter sheet are gone.
11. **The smart search switch moved into More filters.** It is an optional assist, as DESIGN.md says. The keyword chips still show under the search box.
12. **A sort on its own no longer counts as searching.** Latest stays on screen, and changing the sort replaces the history entry rather than adding one.
13. **The pitch banner left the home page.** Its text lives on the About tab under "Toward a public library", one tap from every library page.
14. **The reading-hours counter moved to About.**
15. **Collections only show on Browse for new members.**
    - A member who has not opened anything yet sees "New here? Start with a collection".
    - After that, Recently opened takes that slot.
    - Collections are always on the Lists tab.
16. **The "Most saved this term" shelf is gone.** The Most saved sort covers popularity. The repository methods `mostSavedSince` and `termStart` are now unused but still tested (see section 4).
17. **New: Recently opened.**
    - It reads the member's own opens from `library_item_member_days`, newest day first, then most read that day.
    - It shows only items the member can still see, with 4 on desktop and 2 on a phone.
    - It needs no migration. It reads the member's rows by scan; a `ponytail:` note names a `(member_id, day)` index as the upgrade.
18. **One library header with tabs: Browse, Lists, My items, About.**
    - It appears on all four main pages, so a member always knows they are in the library and how to reach the rest of it.
    - "My library" was renamed "My items", so there is no "my library" inside Library.
19. **Breadcrumbs replace the six back-link styles** on the item, list detail, new item and editor pages. The tap targets are 44 px.
20. **Cards changed everywhere they appear:** library, dashboard, Related, lists and embeds.
    - The title comes first and is the link. It stretches over the card.
    - Type, source and tags are plain text.
    - "Confidential" stays marked.
21. **Sheet rows have five columns:** title with a one-line summary, type, by, year, and saves.
    - Saves show from 3 and up, the same floor as cards.
    - On a phone the columns fold into one line under the title.
    - The sheet sits on a white surface.
22. **The item page labels its facts:** "Kind:", "Format:" and "Engagement:". A bare "Other" or "SLE" said nothing.
23. **No more nested cards in list detail.** The card inside each list row dropped its own border.
24. **About gains "How the library works".** It covers the four places in two lines each. There is no library guide in `/portal/guides` yet.
25. **The "Member workspace" eyebrows are gone** from the library pages.
26. **The search placeholder says what it covers:** "Search by title, topic, author or tag".
27. **Empty states point somewhere.**
    - No results points to fewer words, to removing a filter, and to smart search.
    - An empty library offers Add.
28. **Two things stayed on purpose.**
    - The editor keeps both Publish buttons, because it is a long form.
    - The pull quote keeps its left rule.
29. **Accessibility.**
    - There is a live region: "Showing 48 of 136" after each load.
    - Load more is a real button and names how many rows are shown.
    - Back to top returns focus to the Library heading.
    - Restoring the scroll position jumps there instantly, without the page's smooth scrolling.
30. **No migration, no new flag, no permission change.**

## 3. Manual checks for CJ (beta, after the merge)

1. On a laptop and a phone, open Library and scroll All items to the end. Rows keep coming with no clicks, and the last row says "You've reached the end" with the total.
2. Scroll past row 60, open an item, then press Back. You land on the same row, with the same rows loaded. Do it again with the breadcrumb's "Library" link.
3. Tap a type chip, open More filters and pick a tag. A pill shows the tag; remove it. Then try "Clear search and filters".
4. Copy the URL of a filtered list into a new tab. The same filters and order load.
5. With smart search on (More filters), search "burnout". Keyword chips appear, all results show in one list, and there is no Load more.
6. Recently opened shows what you opened recently. A member who has never opened anything sees "New here? Start with a collection".
7. Keyboard only: Tab to Load more and press Enter. With a screen reader, hear "Showing 48 of 136".
8. On an iPhone: the type chips and Latest swipe sideways, and the page itself never scrolls sideways.
9. Visit the Lists, My items and About tabs. "Add to the library" is on every one of them.
10. As a regular member, confidential items stay hidden. As a library manager, they show with a lock.
11. The member dashboard's library cards look right with the new card style.

## 4. For the merge, and follow-ups

1. **The merge is code only:**
   - no migration
   - no new flag (`FEATURE_LIBRARY` and `FEATURE_LIBRARY_SMART_SEARCH` behave as before)
   - no wrangler change
2. **Follow-up: fix `globals.css`.** Wrap the global `* { border-color }` and `h1-h4 { font-family }` rules in `@layer base`, so every border-color and font utility in the app works. Then the library's `!` workarounds can be dropped. This changes rendering across the whole app, so it should be its own reviewed change.
3. **Follow-up: decide on the unused shelf methods.** Either delete `mostSavedSince` and `termStart`, or bring back a "Most saved this term" view somewhere other than the Browse home.
4. **Follow-up: the bottom bar.** The member mobile bar has no Library destination, and the shell is out of this branch's scope.
5. **Follow-up: Recently opened has no time of day.** It is day-granular because activity is stored per day. Same-day order falls back to the most read.

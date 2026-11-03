# Beta review: 2026-10-23 batch

CJ asked for one place to go over everything that shipped to beta on 2026-10-23: the calls made without asking, and what to check by hand. Each section below belongs to one piece of work. Sections get added as each session's branch is merged into `beta`.

Beta: https://beta.ateneocode.org

## 1. Feedback forms: polish, export, attach on create (main session)

Commits on `beta`: 42daa08, 50548c4, 85929f3, 299bd22, 6a60faa, 243449d, a549cbd, ab2043f, 88dd81c, a0b7436.

### Decisions

1. **Submitting was never broken.** CJ's 2026-10-21 answer saved, with 1 Feedback point. That form closed a minute later, and no other form was open on beta. The real problem was dead ends, so every "no form" state now explains why: closed (with the date), you're on the event team, already answered, or not invited. CRS also gets a "See the questions" link.
2. **Member form page:** a back link, the heading "How was \<event\>?", one line with the question count, the time it takes and the closing date, a two-line privacy note, and a Send button that shows "Sending..." and can't be pressed twice.
3. **Event page card:** renamed to "How was this event?" with the closing date and a Give feedback button. The Home card is now "Feedback forms".
4. **Ended events** drop Sign up, the check-in code and an empty People going card. Signing up after the fact means nothing, and the check-in code is still in the + menu.
5. **Organizers on an ended event** see Feedback and Debrief right under the event details, instead of below the whole event editor. Before the event, that panel only shows once CRS has sent a form.
6. **Status reads Draft / Open / Closed** everywhere, never the raw "running".
7. **CRS results page:** results lead, and Manage this form (closing time, reminder, close, sharing, copy link) sits beside them on wide screens and above them on phones.
8. **Download responses (.xlsx):** one row per response with name, email, invited or walk-in, the time, and every answer. Ratings stay numbers so the sheet can average them. It is CRS only, and each download goes in the audit log as `survey:export`.
9. **Copy form link** in Manage this form, for posting in group chats. The link still needs sign-in and the same eligibility check.
10. **Draft editor:** each question folds to one line (text, type, required, tracked tag), so the Send step is on screen without scrolling past seven big cards. Steps are numbered "1. Check the questions" and "2. Send". Opening or closing a question doesn't count as an unsaved change.
11. **Attach a feedback form** in Create event, with a template choice, shown only to CRS (`survey:configure`, the same people who can make forms today). It makes a draft only. CRS still reviews and sends it from the event's admin page. If attaching fails, the event is still created.
12. **Forms list** is grouped into Drafts to send, Open now and Closed.
13. **Copy:** "Results appear at 3 responses to protect anonymity" became "Results appear once 3 people have answered, so no single answer stands out", because answers are no longer anonymous to CRS. The email button now says Give feedback, the same as the app.
14. **Admin event archive** no longer scrolls sideways on phones. Admin event feedback no longer nests cards.
15. **Debrief boxes** show a short example answer while empty. **Template rows** end in a chevron like the forms list. **Rating legends** put each value's count and share on one line.
16. **Guides** reshot: give-feedback, organizer-feedback, send-form, read-results. Pins come from measured element positions, four per image at most.

### Check by hand

- [ ] As a member invited to an open form: Home shows Feedback forms; tap it, answer, send. The button shows Sending..., then the thanks message names the points.
- [ ] Open the same form again: "You've already answered this form. Each person answers once."
- [ ] An ended event you attended: the How was this event? card is near the top, with no Sign up and no check-in code.
- [ ] As an event's owner after it ends: Feedback and Debrief are right under the details.
- [ ] As CRS: Create event, tick Attach a feedback form, pick a template. The event's admin page then shows "A draft form is waiting to be sent".
- [ ] Draft editor: questions are folded; open one, edit, save; Review and send.
- [ ] Results page on desktop: Manage this form is on the right. Try Download responses, then open the file in Sheets or Excel. Try Copy form link.
- [ ] Results page on a phone: Manage this form is first and everything fits with no sideways scroll.
- [ ] Admin, then Events & Points, then Events on a phone: the table scrolls inside its card, not the whole page.
- [ ] Guides: Give feedback after an event, Send a feedback form and Read feedback results show the new screens.

## 2. Important links (session important-links, merged 590ce2b)

Migration `0015_important_links` is applied to beta D1. Beta had no sidebar pins, so the new page starts empty.

### Decisions

1. Sidebar pins are now Important links. A link with "Show in sidebar" on is the pin, so one URL lives in one place.
2. New tables `link_categories` and `important_links` (rather than renaming `nav_pins`, which makes drizzle-kit stop for a question). `nav_pins` stays in the schema, unused, until a later cleanup migration.
3. Quick links (Dashboard Shortcuts) are left alone. Folding them in is a possible follow-up.
4. Each link's type (sheet, doc, form, folder, site, video) is detected from its URL, and an admin can set it by hand for short links. The 87-icon picker is gone.
5. There is no feature flag, the same as Guides.
6. The tab sits right after Link shortener. The mobile bar is unchanged, and the + sheet lists it.
7. The editor is under Content > Important Links and needs `nav:configure`. Every change goes in the audit log.
8. Reordering uses up and down buttons, which work by keyboard and on phones. Archiving hides a link or a whole category, and Restore puts it back.

### Check by hand

- [ ] Admin, Content, Important Links: add categories (for example "Org files", "Forms", "Drive"), then add the Masterfile sheet link. Its type shows as a sheet.
- [ ] Turn on Show in sidebar for Masterfile, and check it appears under Pinned links.
- [ ] Reorder, archive and restore a link and a category.
- [ ] The member Important links page looks clean on a phone, and links open in a new tab.
- [ ] The old Pinned Nav Links admin URL redirects to the new editor.

## Assumptions made where CJ's notes were thin

CJ said to decide and list these rather than ask. Change any of them on review.

1. **Pments (self-reported Ments):** CJ confirmed removal later the same day, so they're gone (section 7).
2. **"A bar for each kind of point":** read as one bar per retention part, filling toward its minimum, with overflow shown as not counting. That's built in the retention session.
3. **"Retention point fixing tab":** read as the one-screen retention breakdown. Admins already fix wrong points in the Ledger. If CJ meant a new admin tool for corrections, that's a follow-up.
4. **Attach a feedback form at event creation:** only CRS sees it, and it makes a draft rather than sending on its own. The 75/25 split still applies from the moment the event has a form.
5. **Email "we'll wait for a bit":** CJ's later speedrun listed email again, so it's being built (session email-merge-html).

## Merge status

Every session is merged into `beta` as of 23 Oct, about 19:50, and each one has its own section below.

## 3. Speed and loading (session speed-loading, merged 01920a4)

Full numbers and the reasoning are in `docs/architecture/performance.md`.

### Decisions

1. **Biggest costs fixed first:** auth ran three serial queries several times per request (now one round trip, cached per request); independent repository reads ran one after another (now in parallel); `events.listPublished` ran one staff query per event (gone).
2. **Results on a simulated 50 ms link:** Home 861 to 429 ms, Calendar 1068 to 525 ms, event page 1113 to 692 ms, admin events 1069 to 708 ms. About 50 KB less JavaScript per route (QR and scanner libraries now load only when used).
3. **No KV or Durable Object.** Measured, the time went to serial database waves, not repeatable reads. A cache would add invalidation bugs for little gain. See the doc's caching section.
4. **Loading feedback:** every section has a `loading.tsx` skeleton shaped like the real page, there is a thin top progress bar on navigation (it appears only after 150 ms), and every submit button shows a pending state automatically.
5. **Errors and offline:** a page that fails or a lost connection shows a calm message with a way back, instead of a blank screen.

### Check by hand

- [ ] Click around Home, Calendar, an event, Retention and Library. Each click shows a skeleton or the top bar within a beat, never a frozen page.
- [ ] Submit any form, such as saving a debrief. The button shows it's working.
- [ ] Turn off Wi-Fi and click a link. You get the offline message, not a broken page.

## 4. Library declutter and infinite scroll (session library-scroll, merged into beta)

Full audit and 29 decisions: `docs/superpowers/specs/2026-10-23-library-browse-redesign.md`.

### Highlights

1. **Browse opens on Latest (a few newest items), then All items** as one A to Z sheet that loads more as you scroll. There is no Next page. A "Load more" button stays as a fallback.
2. **Back keeps your place:** the list remembers your scroll position, search and filters.
3. **Fewer controls up front:** one search box and a few filters, with the rest under More filters. Smart search moved into More filters.
4. **One header with tabs:** Browse, Lists, My items, About. The pitch banner, the reading-hours strip and the duplicate Most saved shelf moved to About or were removed.
5. **New:** Recently opened, breadcrumbs instead of six back-link styles, labeled facts on item pages, and empty states that point somewhere.
6. **Follow-up pass:** the item page, lists, My items and the editor got the same calm treatment.

### Check by hand

- [ ] Library on a phone: Latest, then the list. Scroll to the bottom, and more rows arrive.
- [ ] Open an item, then Back. You land where you were.
- [ ] Search, filter, open an item and go back. The search is still there.

## 5. Retention: 8 parts and the 75/25 feedback split (session retention-redesign, merged 07a35df)

Model, data and all calls: `docs/superpowers/specs/2026-10-23-retention-parts-design.md`. Migration `0016_retention_parts` adds the 8 part point types, marks them yearly or semestral, adds a 2nd-semester start date per school year, and removes the old "retained at / probation below" thresholds. The old values were backed up first: Term 1 2026 had retained at 20 and probation below 10.

### Highlights

1. **Retained means all 12 slots met:** 4 yearly parts at 1 point each, plus 4 semester parts at 1 point per semester. Extra points never count toward retention, but they do count toward milestones.
2. **The page is a report card:** "N of 12 requirements met", a 12-slot strip, a grid of parts by semester, a dashed "Not counted toward retention" group for other point types, and milestones. The old stat tiles, streak, rank and charts are gone.
3. **Feedback split:** events with a feedback form pay 0.75 at check-in. The remaining 0.25 arrives when the member answers. Organizers and staff are paid in full. Every attendee can answer, sampled or not. The event and form pages show a one-line note about the split.
4. **Guess to correct:** the 2nd semester was set to start on 11 January. Fix the real date in Admin > School years.

### Check by hand (from the session's list)

- [ ] `/portal/retention`: "N of 12 requirements met", the strip and its legend, and each part's boxes.
- [ ] Admin > School years: set the real 2nd-semester date and save.
- [ ] Admin > Point types: the 8 parts read "Retention: each year" or "each semester" and can't be retired. Others read "Not counted for retention".
- [ ] On an event someone else owns that has a feedback form: check-in gives 0.75, answering gives the other 0.25, and the Ledger shows "Feedback form, the other 25%".
- [ ] Admin > Events & points: Needs attention lists "Missed a retention requirement" and "Feedback form not sent".
- [ ] Home: the Retention path card shows the strip and "N parts still open".

## 6. Email: sheet mail merge and HTML emails (session email-merge-html, merged 01d4a2a)

Migration renumbered to `0017_email_merge_sheet` (one new column).

### Highlights

1. **Paste from Google Sheets or Excel** (or upload a CSV or XLSX). Columns become merge variables such as `{{batch}}`, matched to recipients by email. Unmatched rows and missing values show before sending, and the sheet is saved with the draft.
2. **HTML emails:** paste your own HTML and CSS, and a preview beside it shows light, dark and phone widths. Unsupported features get a warning, and what's sent is sanitized.
3. **Base HTML template** with comments, to copy into your own AI agent, behind a disclosure.
4. **Follow-up pass:** calmer steps, a download of the recipient sheet, and a fix that keeps the composer open after its first autosave.

### Check by hand

- [ ] New email: paste a few rows from a Sheet with an Email column and a custom column, then use `{{that column}}` in the body. The per-recipient preview fills it in.
- [ ] Switch to HTML, paste a template, and toggle dark and phone previews.
- [ ] Send a test to yourself only.

## 7. Ments: Pments removed (main session, 46043e3)

CJ asked for Pments to go. The tree shows official Ments only: no Show Pments switch, dashed lines, self-report list or admin Pment reports. Starter emails no longer mention Pments. The `ments_pments` table stays, unused, so nobody's saved rows are lost. A later cleanup migration can drop it.

- [ ] Ments Tree: no Pments anywhere. Stats show People, Ments trees and Deepest tree.
- [ ] Admin > Members & Access > Ments Tree: only the official editor.

## 8. Member pages polish (session member-polish, merged 2ae8bc9)

### Decisions

1. **Home leads with the next action:** a waiting feedback form comes first, event rows say Today, and the check-in code link shows on event days. The four number tiles are gone.
2. **Names match everywhere:** the rail says Home, like the page and the phone tab. The desktop top bar names only the section and links back to it from deeper pages.
3. **Notifications:** a divided list split into New and Earlier, with times and mark-as-read.
4. **Calendar:** a shared header, Month and List tabs, a phone agenda under the month that says Today, and past events behind a disclosure.
5. **Profile:** a compact header with the check-in code right under it. Details show as text, with "Not set" until you edit them.
6. **Create event** opens with Title, Type, Place, When and Description, and the rest sits under More options. A disabled button names the fields still missing.
7. **Link shortener:** calmer filters, no Refresh button, and a short "What these words mean" glossary.
8. **Shell:** the + button is named "Check-in code and quick actions", labels are at least 11 px, and the bell badge has readable contrast.

### Check by hand

- [ ] Home on a phone with a form waiting: the form card is first.
- [ ] Create event: the short form, More options, and the disabled button saying what's missing.
- [ ] Notifications: New and Earlier.

## 9. Fixes made while merging (main session)

1. **Global styles:** the default border colour and heading font now sit in `@layer base`. Before, they silently overrode every Tailwind border colour (`border-primary` and so on) and `font-sans` on headings across the whole app. Selected and active states that were meant to be navy now are. The `!` workarounds three sessions had added are removed.
2. **A flaky events test** assumed two rows land in the same millisecond. It now checks membership instead of order.
3. **Session follow-ups merged:** retention calm pass, email autosave fix and sheet download, library item and editor pages, Important links search, copy and New labels, and speed's second pass (library item, admin member and records pages, lighter Links).
4. **The graph** keeps beta's larger graphify output. A session's refresh would have shrunk it.

## 10. Photo gallery (session photo-gallery, merged e843316)

Migration `0018_gallery` adds the gallery tables and a "Photo gallery" admin role. `FEATURE_GALLERY` is on for beta only. The R2 bucket, the Images binding and the per-minute cron already existed on beta.

### Decisions

1. **Your answers, built as given:** nested folders; anyone can delete any photo; deletes are soft for 30 days, and the person who deleted, a Photo gallery admin or a super admin can restore; photos and videos with no size cap (a warning past 1 GB); folder deletes are recoverable too; the uploader is always recorded for accountability.
2. **Scrapbook browsing:** a front page with Recent events first, then Albums, plus Most loved (hearts), Most viewed and Most tagged, and search across people, events, captions and albums.
3. **Every event gets an album automatically,** past events included. Its call: an album appears when the event *starts*, not after it ends, so photos can go up during the event. Say if you want "after it ends" only.
4. **Clutter control:** recent events lead, older ones stay reachable through search and the browse modes, and empty event albums show as a quiet "Add photos" tile.
5. **Recently deleted** shows how many days are left on each item.
6. **Public albums:** gallery admins can make a folder public at `/gallery`.
7. **Prod note:** prod has no cron trigger, so the 30-day purge and the event-album backfill won't run there until one is added.

### Check by hand

- [ ] Gallery: open an event album, upload a few photos (and a short video) from your phone.
- [ ] Heart a photo, tag someone, then search for them.
- [ ] Delete a photo, find it in Recently deleted with its days left, and restore it.
- [ ] Make a folder public as a gallery admin, then open `/gallery` signed out.

## 11. Needs CJ: data and access

- [ ] **School year dates (important for retention):** beta's only school year, "Term 1 2026", runs 18 Jun to 1 Nov. The new model treats a school year as two semesters, so the 2nd-semester date could not be guessed and the page splits the year at its midpoint. In Admin > School years, give it the real school-year end and the real 2nd-semester start. Or tell me the dates and I'll set them.
- [ ] **Signed-in checks:** your browser was connected at first, then dropped (the Claude extension disconnected), so the signed-in checks above are still to do. Reconnect the extension and I'll run them, or tick the lists yourself.

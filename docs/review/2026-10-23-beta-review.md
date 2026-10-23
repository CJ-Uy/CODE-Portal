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

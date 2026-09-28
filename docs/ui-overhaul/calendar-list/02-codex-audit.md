# Calendar list audit

Status: observed; design pending
Date: 2026-09-28
Surface: authenticated beta calendar list and event detail, desktop and 390 x 844 mobile.

1. **Time hidden:** current list sections are “Your events” and “Everything else.” Both beta records are past, yet neither is marked Past. Role labels already appear on each row, so ownership does not need to drive the primary grouping.
2. **Future visibility risk:** `loadEventList` calls `listPublished()` without paging. Repository returns the earliest 50 events in ascending order. Once 50 older records exist, future records may never appear in List. Date grouping alone cannot fix that.
3. **Past detail context:** an August event still opens with Sign up and Check in cards. Keep policy unchanged, but use timing to put past recap/attendance context first and review whether those actions should remain active.
4. **Mobile:** list rows are readable and fit the viewport. Date and event type are clear. The desktop “Manage” cue disappears on mobile, while the whole row remains a link. A compact role/action cue would improve discoverability.
5. **Month view:** current September grid is empty while List contains older events. The Calendar/List switch works, but List needs a current-time anchor so the different scopes are clear.

Working: Calendar/List navigation, current month, event detail, event QR and export links render. No event, signup, or attendance changes were submitted. Feature worktree source and beta UI were read directly; graph index is older than this worktree. No independent Claude audit was available in this session.

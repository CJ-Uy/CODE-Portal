# Calendar list UI brief

Status: approved scope, design pending
Owner: human
Date: 2026-09-28

## User and journey

- Primary user: CODE member finding the next event or reviewing a previous one.
- Start: `/portal/calendar`, then List.
- End: find Today, Upcoming, or Past events and open the right event detail.
- Current pain: current list groups by ownership, so two past events appear as “Your events” and “Everything else” with no time cue.

## Desired outcome

- User outcome: event time state is obvious; ordering is predictable; ownership remains visible on each event.
- CODE impression: clear, calm, useful on a phone.
- Success signal: Today, Upcoming, and Past are distinct; future events cannot disappear behind old history; sections and detail actions match event timing.

## Constraints

- Keep month and list routes, permissions, event codes, event types, points display, role cues, and signup/check-in policy.
- Use UTC+8 calendar dates already used by the app, CODE tokens, and existing components.
- Keep 390 and 1280 px layouts free of page overflow.

## Non-goals

- No event lifecycle, attendance, points, or permissions redesign.
- No database migration or deploy in this review.

## Human Gate 1

- Decision: calendar list and broader calendar UX research requested directly by user.
- Approved by: user, 2026-09-28.
- Comments: group past, today, upcoming events.

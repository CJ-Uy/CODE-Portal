# Shortlinks QR and Analytics UI/UX Brief

Status: approved
Owner: human

## User and journey

- Primary user: A signed-in CODE member managing official short links, with owner or moderator controls where authorized.
- Start: `/portal/links`.
- End: The member can inspect a link, customize and verify a saved QR style, export a safe QR, or read statistics with an explicit query scope.
- Current pain: The workspace silently shows only 50 links, rows are not fully keyboard-operable, QR choices and safety feedback are limited, editor state can leak between links, and analytics apply date scope inconsistently.

## Desired outcome

- User outcome: Manage links from one familiar workspace, use a persistent QR preview beside controls on desktop and above controls on mobile, and understand exactly what analytics are filtered.
- CODE impression: Member-first, precise, calm, and recognizably CODE rather than a copy of ARSA or Mobbin products.
- Success signal: Owners and moderators can complete the journey by keyboard or pointer at `320px`, `390px`, and desktop widths without horizontal overflow, stale state, unsafe downloads, or ambiguous reporting scope.

## Constraints

- Behavior to preserve: Search, sorting, tags, owner information, creation, editing, moderation, social previews, sharing, saved QR settings, fullscreen, audit logs, member visibility, and public root-slug redirects.
- Brand requirements from `DESIGN.md`: Use CODE tokens, Unna headings, Source Sans body, navy `#06192F` on white by default, existing shadcn-style controls, lucide icons, and unchanged official falcon artwork.
- Accessibility/mobile requirements: WCAG 2.1 AA target, semantic controls, visible focus, Escape and focus return, 44px targets, reduced motion, and no mobile or desktop horizontal overflow.
- Technical constraints: Extend the current repository/contracts and aggregate tables. Preserve server-side ownership and `link:moderate` checks with super-role inheritance. No database reset, migration, seed, deployment, merge, or push is authorized.

## Non-goals

- A second shortlinks subsystem, an admin-only policy, or a redesign of `/`, `/portal`, authentication, or unrelated modules.
- Raw click logging, fabricated referrer domains, inferred bots, or rewritten historical source/device data.
- ARSA colors, fonts, logos, account configuration, bindings, migrations, or policy.

## Human Gate 1

- Decision: approved
- Approved by: human
- Date: 2026-09-16
- Comments: So i just  upgraded a project called arsa-website with a better link shortener or redirects admin page ui ux by building ontop of the one used here so can you use the findings it has i uploaded here to upgrade the current link shortener as well ?

The uploaded implementation prompt and acceptance companion define this approved bounded journey. No independent Claude audit was performed or claimed.

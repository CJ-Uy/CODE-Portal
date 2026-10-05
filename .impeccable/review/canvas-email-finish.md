# Canvas and email follow-up release check

The existing CODE palette, type, shell and research direction are preserved.
The follow-up briefs record the user-requested downward canvas, drag/swipe pan,
wheel zoom, automatic member focus at 50%, larger wrapped-name cards, sidebar
order, feature-announcement starter, email image uploads and PHP pricing.

The detector ran once against this UI scope. A separate finish reviewer found
one mobile issue: fixed bottom navigation partly covered the centered card.
Reducing the mobile canvas from 32rem to 24rem resolved it. The 38rem desktop
canvas is unchanged. Fresh 390x844 mobile captures show the entire 50% card
and the longest name at 100%, above navigation. The scoped second-round
verdict was: "Clear. This verdict covers the scored fix, not the whole surface."
Disposition: ship.

Parent verification covered desktop/mobile horizontal overflow, downward
connections, cursor-centered wheel zoom, full drag movement, keyboard controls,
automatic member selection, starter previews, image controls and the pricing
tooltip. The public upload endpoint returned 201 in local review. An Email
role authorization test covers upload creation; member rejection and public
read behavior also passed. No real email was sent.

Validation: pnpm lint passed with existing warnings; 53 scoped Worker tests
and 8 component tests passed, with the final 14 upload tests passing after the
permission correction. pnpm build completed both Next and OpenNext. The shared
dev deployment note check and git diff whitespace check passed. graphify update
completed with 9,067 nodes and 18,583 edges.

Beta needs no new schema migration. Staged setup and root-domain reply routing
are separately held for command-specific approval under AGENTS.md.

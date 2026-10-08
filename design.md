# CODE Portal design

## Product shape

CODE should open as a public publishing site, not as the member portal. The public site keeps articles, public resources, event notices, and non-confidential updates on `/`. A low-emphasis member access link points to `/portal`, where the signed-in member demo lives.

The older `open design` folder split the member area into many static pages and referenced missing CSS, JavaScript, and image assets. The current direction keeps the same member scope but separates the public site from the member workspace.

## Public routes

- `/`: public landing, featured writing, public library preview, public updates, and low-emphasis member access.
- `/articles`: public publishing index.
- `/articles/[slug]`: public article detail pages.
- `/portal`: member workspace demo. Authentication is not wired yet.

## Main modules

- Overview: member status, retention progress, survey requests, saved content, short link activity, and quick actions.
- Profile: member details include full name, nickname, pronouns, roles, retention points, and guided tour status.
- Private library: confidential case studies, public-plus resources, tools, comments, favorites, saved lists, filters, and a future graph search path.
- Short links: official slugs, destination URLs, ownership, shared statistics, admin moderation, QR export, logo placement, light mode, dark mode, and transparent export.
- CRS: event creation, QR attendance, archive proof, forum discussion, random survey selection, approval, point assignment, and audit history.
- Calendar: shared month and agenda views for official events, casual events, birthdays, CRS deadlines, and announcements.
- Announcements: targeted notices with pinning, scheduling, and admin publishing controls.
- Admin: role assignment, scoped permissions, super admin inheritance, CRS approvals, link moderation, publishing queues, and audit logs.

## UX decisions

- The home route should serve readers first. Members can enter the portal through a quiet access link.
- One portal shell is easier than ten member pages. Module tabs let users move quickly without losing context.
- Admin tools stay visible only as a module in the signed-in workspace. Super admins inherit all scoped roles, while specific admins see only the queues they can act on.
- CRS is modeled as a simple lifecycle: create, scan, archive, approve. Feedback forum access and selected surveys are treated as separate actions.
- The private library is filter-first. Graph search is presented as an advanced assist, not the default way to find content.
- Guided tours are available from the header and can be replayed for both member and admin flows.

## Interface system

The app uses Tailwind CSS v4 and shadcn-style local components. Tokens live in `src/app/globals.css`, while reusable primitives live in `src/components/ui`.

The visual direction follows the supplied CODE brand manual and official logo exports. Headings use Unna. Body text uses Source Sans. Main colors are navy `#06192F`, white `#FFFFFF`, blue `#0C315C`, light blue `#D7DFE9`, dark gray `#121315`, and pale blue `#90B4CC`. Supporting colors are `#4986AC`, `#3D5266`, `#343B41`, `#717D89`, and `#AAAFB5`.

Copied brand assets live in `public`:

- `code-logo-full-navy.png`
- `code-logo-full-white.png`
- `code-falcon-transparent.png`
- `code-doc-cover.png`
- `code-form-cover.png`

## Admin workspace

The admin workspace extends the existing CODE interface system. Unna headings establish the task and section hierarchy; Source Sans carries descriptions, controls and records. Keep the official assets, shared tokens and local UI primitives.

### Directory and navigation

The overview is a searchable directory of permitted tools, grouped into Members & Access, Content, Email, Events & Points, and System. Section headings sit above shallow white lists with divided rows. Each row has a tool name, a short task description and a trailing arrow. Search and section filters update the result count in place; an empty result offers a clear reset. The directory uses two columns on desktop and one on mobile, with wrapping filter controls.

The navy desktop rail includes Overview, expandable sections and Back to portal. Native disclosures open the current section and keep its tools visible. Active tools use a tonal selection and stronger text, with visible keyboard focus. Breadcrumbs begin with Portal and Admin, link the ancestors and end with the current page or detail label. Use the registered tool's section ownership for the trail, including tools whose URLs live under a different section. Long trails wrap.

On mobile, the navy app bar remains above a separate breadcrumb strip. A fixed bottom bar provides Portal, Overview and Menu. Menu opens a scrollable bottom sheet with the same grouped tools and closes after navigation. Reserve bottom space for the bar and respect the device's safe area.

The member rail orders Overview, Calendar, Retention, Ments Tree, Link shortener, Mail, Notifications and Profile. Library and Announcements sit under Resources & updates. Release flags hide unavailable destinations. The member mobile bar keeps four core destinations: Home, Calendar, Retention and Profile, with Link shortener filling the Retention slot when that feature is unavailable. The center plus opens a bottom sheet with Create event and New short link above the remaining destinations. Its fixed handle supports drag-to-close; event check-in sits in a compact disclosure below navigation.

### Ments Tree

The member tree uses one bordered canvas for the complete forest and every generation. Generations descend vertically through person buttons (260 by 144 px), with full names wrapping inside each cell. Solid paths represent official Ments; optional dashed paths represent self-reported Pments. People are HTML buttons with named selection and focus states. Dragging or swiping pans the canvas; scrolling zooms around the pointer. With the canvas focused, arrow keys pan, + and - zoom, and 0 resets to the whole forest. Search, Find me, whole-forest fit, branch fit, fullscreen and copied person links support exploration. Canvas controls wrap in groups on narrow screens.

The first view centers the signed-in member at 50% zoom when an account link or a unique normalized name identifies their person. Name matching locates the view without changing account links. Find me returns to the same centered 50% view. A valid shared person link takes precedence; unmatched members see the whole forest and guidance to search or request an account link. Whole-forest fit shows structure; selecting or searching for a person restores a readable local view.

The selected person's lineage follows the canvas. Statistics use an open definition list, followed by divided rows for the largest trees. The mobile statistics grid has two columns. Members choose and save their own informal Pments directly in a searchable checkbox list below the statistics. Official relationship editing stays in Members & Access, with an Explore tree link back to the member view.

### Email templates and personalization

The template gallery pairs rendered previews with names, use cases and separate Use template and Customize & save actions. Nine built-in starters cover a CODE Portal feature announcement, welcome, invitations, reminders, event thanks, roundups, feedback, resources and Ments. The feature announcement uses CODE Mail as an editable example. Starters open as editable content alongside saved templates without requiring seed data. The searchable gallery uses one column on mobile, two at intermediate widths and three on wide desktops.

Image blocks offer a public upload or an image URL, a description for screen readers and an optional link. Upload controls name the supported formats (PNG, JPG, WebP and GIF), the size limit (5 MB) and the public visibility needed for recipients to view the image. Keep upload progress and errors next to the control.

The email allowance tooltip distinguishes the account's billing-cycle allowance, shared across beta, staged and live, from this workspace's calendar-month counter and daily sending cap. It shows the extra sending rate with an automatically refreshed approximate PHP quote, its date and sources; unavailable conversion leaves the USD rate readable.

Personalization is a dedicated composer step for the actual receiving audience. A searchable, paginated recipient list exposes missing fields and uses light blue selection. Selecting a recipient shows their merge values, rendered subject, preview text and message. The list and preview sit side by side when space allows and stack on narrower screens. Corrections are marked and saved with the email draft; the email address remains read-only, and Use profile values clears that recipient's corrections. Keep draft corrections separate from member profile editing. Confirmation values wrap at word boundaries, with long addresses breaking only when needed. On mobile, Test and Review sit above the admin navigation bar with space reserved for both.

## Writing rules

Interface copy should be plain and specific. Avoid em dashes, curly quotes, promotional filler, title-heavy prose, needless buzzwords, and stock phrases associated with AI-generated writing. Keep labels short, use real nouns, and prefer active verbs.

## Current prototype

`src/app/page.tsx` implements the public site. `src/components/portal-workspace.tsx` implements the signed-in workspace with interactive module switching and basic library filtering. Authentication, database-backed content, QR generation, camera scanning, analytics, permissions, and graph retrieval should be built as separate implementation phases.

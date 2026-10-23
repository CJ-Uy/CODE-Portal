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

- Overview: member status, the retention verdict line with its slot strip, survey requests, saved content, short link activity, and quick actions.
- Profile: member details include full name, nickname, pronouns, roles, retention status with requirements met, and guided tour status.
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

The member rail orders Overview, Calendar, Retention, Ments Tree, Link shortener, Important links, Mail, Notifications and Profile. Library, Announcements and Guides sit under Resources & updates, followed by Pinned links: the important links an admin marked Show in sidebar, each with its link type icon. Release flags hide unavailable destinations. The member mobile bar keeps four core destinations: Home, Calendar, Retention and Profile, with Link shortener filling the Retention slot when that feature is unavailable. The center plus opens a bottom sheet with the expanded event check-in QR first, followed by Create event and New short link above the remaining destinations, Important links among them, then the pinned links. Its fixed handle supports drag-to-close.

### Important links

Important links is the member directory of CODE's official sheets, documents, forms and folders. Category headings, in the order admins set, sit above white lists with divided rows, two columns of sections on wide screens and one on phones. Each row is a single link that opens in a new tab: a light blue type tile, the title, an optional one-line description, and a meta line naming the type and the site it opens, such as Spreadsheet · docs.google.com. The type is set by an admin or detected from the link (Google, SharePoint and OneDrive file links, forms, Drive folders, file extensions and video sites). Links without a category list last under Other links. Admins see Edit links; with nothing published, admins get Add the first link and members learn that admins fill the page.

The editor lives under Admin, Content. Add a link and Add a category sit at the top. What members see follows as the same categories and rows, each with up and down arrows to reorder and a native Edit disclosure that holds the full form, the Show in sidebar option and Archive. Archived categories and links collect in an Archived list with Restore. Pinned links are not a separate tool any more: a link with Show in sidebar on is the pin.

### Ments Tree

The member tree uses one bordered canvas for the complete forest and every generation. Generations descend vertically through person buttons (260 by 144 px), with full names wrapping inside each cell. Solid paths represent official Ments; optional dashed paths represent self-reported Pments. People are HTML buttons with named selection and focus states. Dragging or swiping pans the canvas; scrolling zooms around the pointer. With the canvas focused, arrow keys pan, + and - zoom, and 0 resets to the whole forest. Search, Find me, whole-forest fit, branch fit, fullscreen and copied person links support exploration. Canvas controls wrap in groups on narrow screens.

The first view centers the signed-in member at 50% zoom when an account link or a unique normalized name identifies their person. Name matching locates the view without changing account links. Find me returns to the same centered 50% view. A valid shared person link takes precedence; unmatched members see the whole forest and guidance to search or request an account link. Whole-forest fit shows structure; selecting or searching for a person restores a readable local view.

The selected person's lineage follows the canvas. Statistics use an open definition list, followed by divided rows for the largest trees. The mobile statistics grid has two columns. Members choose and save their own informal Pments directly in a searchable checkbox list below the statistics. Official relationship editing stays in Members & Access, with an Explore tree link back to the member view.

### Member retention

The retention page reads as a school-year report card. Retention is 8 parts with 1 point per slot, 12 slots a year, so the page tracks requirements met, not a points total. A verdict line opens the page in Source Sans: the status in semibold, then "5 of 12 requirements met" in tabular numerals, then the next deadline and the parts it closes. Below the verdict, a 12-slot strip shows the yearly slots, a gap, then the semester slots. Each slot is a short bar: CODE blue (#0C315C) for earned points, the pending hatch for an unanswered feedback share, a dashed outline for a semester that has not opened, and a dimmed flat bar for a missed slot. A small key names Met, Part done, Waiting on a form and Not open yet; it disappears once every slot is met. One short line follows the strip: the next deadline and its parts while on track, "Every requirement is met for this school year. Nice work." with a check once retained, or a calm note that an officer can add a missing record once a slot is missed. The home tile reuses the verdict and strip without the key, counts the open parts instead of naming them, and adds the points still waiting on feedback forms. Officers see the same verdict without the lines spoken to the member.

The pending hatch is one shared pattern: diagonal stripes in the ring blue (#4986AC) on a light ground. It marks points a member can still unlock by answering a feedback form. The same hatch appears on the strip, in grid cells, in the pending feedback panel, and in the notes on event and form pages. The pending feedback panel and both notes use the same frame, a light-blue fill with a ring-blue border. The panel opens with "Feedback forms waiting on you" and the total, one line of why, then one row per event with its points, its closing time and an Answer button. Each note is a single line: the event note explains the 75/25 split, or names the viewer's own points still waiting; the form note names what answering adds. A pending share in a grid cell links to the panel.

The requirements grid has a part label column and two semester columns, and each semester head shows its dates. Yearly parts sit under "Once this school year" and their cells span both semesters. Semester parts sit under "Once each semester" with one cell per semester. Met cells fill CODE blue with a check and the word Met, and they drop the progress bar and the date. Open cells show "0.75 of 1" with a bar, plus the hatch for any pending share. Overflow is a dashed chip that reads "extra, not counted". Upcoming cells are short dashed cells that read "Opens" and a date. Missed cells go flat with an x and say what the slot closed with. State comes from fill, icon and words, never from red or green. On mobile the part label moves above its cells and the two columns stay down to 320 px. A native "How retention works" disclosure sits under the grid.

"Not counted toward retention" lists other point types in a dashed frame, so they read as outside the requirements. Milestones sit beside it on desktop: each point type gets a thin rail with round markers, a label under each marker that is clamped at the rail's edges, and a check on reached milestones. Milestones count every point, extra points included. A member with no records sees one dashed line inviting them to check in, with a link to the calendar. Activity history comes last: a divided list of the newest 5 records with Show all, filtered by point type, and a quiet "Something missing? An officer can add it." A split check-in reads "75% at check-in" instead of repeating its reason. A retention part gets a filled type chip; any other type gets a dashed chip that reads "not counted".

### Email templates and personalization

The template gallery pairs rendered previews with names, use cases and separate Use template and Customize & save actions. Nine built-in starters cover a CODE Portal feature announcement, welcome, invitations, reminders, event thanks, roundups, feedback, resources and Ments. The feature announcement uses CODE Mail as an editable example. Starters open as editable content alongside saved templates without requiring seed data. The searchable gallery uses one column on mobile, two at intermediate widths and three on wide desktops.

Image blocks offer a public upload or an image URL, a description for screen readers and an optional link. Upload controls name the supported formats (PNG, JPG, WebP and GIF), the size limit (5 MB) and the public visibility needed for recipients to view the image. Keep upload progress and errors next to the control.

The email allowance tooltip distinguishes the account's billing-cycle allowance, shared across beta, staged and live, from this workspace's calendar-month counter and daily sending cap. It shows the extra sending rate with an automatically refreshed approximate PHP quote, its date and sources; unavailable conversion leaves the USD rate readable.

Personalization is a dedicated composer step for the actual receiving audience. A searchable, paginated recipient list exposes missing fields and uses light blue selection. Selecting a recipient shows their merge values, rendered subject, preview text and message. The list and preview sit side by side when space allows and stack on narrower screens. Corrections are marked and saved with the email draft; the email address remains read-only, and Use profile values clears that recipient's corrections. Keep draft corrections separate from member profile editing. Confirmation values wrap at word boundaries, with long addresses breaking only when needed. On mobile, Test and Review sit above the admin navigation bar with space reserved for both.

## Writing rules

Interface copy should be plain and specific. Avoid em dashes, curly quotes, promotional filler, title-heavy prose, needless buzzwords, and stock phrases associated with AI-generated writing. Keep labels short, use real nouns, and prefer active verbs.

## Current prototype

`src/app/page.tsx` implements the public site. `src/components/portal-workspace.tsx` implements the signed-in workspace with interactive module switching and basic library filtering. Authentication, database-backed content, QR generation, camera scanning, analytics, permissions, and graph retrieval should be built as separate implementation phases.

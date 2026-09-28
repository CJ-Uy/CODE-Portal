# CODE

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

CODE members are the primary users. They use the portal to manage participation, retention requirements, member resources, events, and organization activity.

Public readers are a secondary audience. They use the public site to read CODE articles, browse public resources, and follow non-confidential updates.

Scoped administrators manage the parts of the organization assigned to their roles. Super administrators inherit all administrative permissions.

## Product Purpose

CODE gives members one trusted place for organization work that would otherwise be split across documents, forms, links, calendars, and manual records. It combines publishing, private resources, events, CRS participation and points, official short links, surveys, announcements, and administration.

Success means public readers can find useful CODE material without entering the member workspace, while members and administrators can complete routine organization work with clear ownership and reliable records.

## Positioning

CODE connects public publishing with a private, role-aware member workspace built around the organization's actual operating model. Events, attendance, CRS points, surveys, resources, official links, and administrative actions share member identity, permissions, and audit history instead of operating as disconnected tools.

## Operating Context

- The public site at `/` serves readers first. Member access remains available with low emphasis.
- The private workspace at `/portal` supports signed-in members and scoped administrators.
- Members use a shared calendar for official events, casual events, birthdays, CRS deadlines, and announcements.
- The CRS lifecycle covers event creation, attendance scanning, archive proof, approval, and point assignment. Forum participation and selected surveys are separate actions.
- Members use official short links with QR exports and shared statistics.
- Administrators manage members, roles, content, event rules, retention records, surveys, announcements, links, navigation, exports, and audit history within their assigned scopes.
- The application runs as a Next.js web product on Cloudflare. Shared development mode uses the deployed beta Worker and typed internal APIs.

## Capabilities and Constraints

- Keep `/` public and reader-first. Keep the member workspace at `/portal`.
- Public content and public resource previews must not expose member-only or confidential material.
- Private library content supports public, member, and confidential access levels.
- Surveys marked anonymous must remain aggregated and must not be traceable to individual members.
- Administrative access is permission-based. Scoped roles expose only the queues and actions assigned to them, while super administrators inherit all scopes.
- Official links need stable slugs, QR export, ownership, moderation, and shared usage statistics.
- Event records need controlled creation, attendance, archive, approval, point assignment, and audit history.
- Destructive database operations, migrations, seeds, and production-touching commands require explicit approval.
- Authentication, permissions, repository checks, and API boundaries must enforce access rules. Hiding controls in the interface is not sufficient authorization.

## Brand Commitments

- The product name is CODE.
- Use plain, specific interface language. Avoid promotional filler, buzzwords, and generic AI wording.
- Preserve the official CODE logo colors and proportions. Do not recolor, stretch, crop, outline, shadow, or otherwise manipulate the logo.
- Preserve the supplied CODE brand manual, official logo exports, cover assets, and established brand palette.
- Official assets live in `public`, including the full navy and white logos, falcon marks, and document and form covers.

## Evidence on Hand

- `DESIGN.md` records the current product shape, route strategy, modules, and interface commitments.
- `src/app` contains the public site, member portal, calendar, events, library, links, surveys, announcements, profile, notifications, and scoped admin routes.
- `src/server/auth` contains actor resolution, member access, scoped permissions, role handling, and related tests.
- `src/db` contains the application schema, repositories, seed data, and integration tests for member and organization workflows.
- `public` contains official CODE logo, falcon, document cover, and form cover assets.
- Real customer testimonials, external benchmarks, press claims, and pricing evidence are not present and must not be fabricated.

## Product Principles

1. Serve public readers first and keep member access available without making the portal the public homepage.
2. Make routine member work easy to find and complete from one workspace.
3. Protect member confidentiality and enforce every privileged action at the server boundary.
4. Match CODE's real roles and event lifecycle instead of forcing generic content or project-management patterns.
5. Keep records understandable, auditable, and recoverable by the people responsible for them.

## Accessibility & Inclusion

Target WCAG 2.1 AA across public and member-facing surfaces. Support keyboard navigation, visible focus, semantic structure, sufficient contrast, useful labels and status messages, responsive layouts, and reduced-motion preferences.

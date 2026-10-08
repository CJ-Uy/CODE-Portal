# Member workspace design documentation

Checked 2026-10-08. Ordinary local extension of `/portal`, `/portal/events` and `/portal/ments`. No replacement visual world or durable system change was approved. Documentation is complete at this bounded scope; the incumbent global design files are preserved.

## Files changed by the documenter

- `.impeccable/surfaces/src-app-portal.md`: clarified the completed Manila date behavior, approved-event paging, check-in-first order and stable 220 px QR display size.
- `.impeccable/review/member-workspace/design-documentation.md`: this comparison and completion record.

The retention and Ments briefs already describe the finished corrections and were preserved. No source, tokens, graph files, PRODUCT.md, DESIGN.md or configuration file was edited by this handoff. `.impeccable/design.json` was absent and remains absent.

## Incumbent system comparison

| System or behavior | Evidence checked | Documentation outcome |
| --- | --- | --- |
| CODE identity and ground | PRODUCT.md Brand Commitments; DESIGN.md Interface system; `src/app/globals.css:5` light palette and dark overrides. The actual light ground is `#f5f5f6`, with white content surfaces, navy primary and blue accent. | All ten finished captures retain the navy shell, neutral page field, white surfaces and established CODE identity. No new palette or logo treatment is established by this extension. |
| Typography | `src/app/layout.tsx:2` loads Source Sans 3 at 400/600/700 and Unna at 400/700. `src/app/globals.css:91` assigns the body face and line 99 assigns the heading face. | Home, Points and Ments retain Unna headings and Source Sans controls and record text. The lighter body strokes in the supplied WebKit captures do not establish a different font or token. |
| Controls and depth | `src/components/ui/button.tsx`, `card.tsx`, `member-code-card.tsx` and `src/components/portal/portal-shell.tsx`. Current Home and Ments source imports the house primitives and lucide icons. | Existing corners, borders, shallow shadows, tonal selection and focus treatment continue. Home reuses the member check-in card. Ments keeps HTML person controls inside its existing canvas rather than creating a new global component vocabulary. |
| Home task order | `src/app/portal/page.tsx:53` filters approved current/future events, with continued 100-row paging at line 55. Manila date formatters appear at lines 61-62; plain Home at line 67; check-in at line 72. | The member pass comes first, events second, followed by the existing conditional dashboard content. Desktop pairs the pass and event list; mobile stacks them. The brief now records these completed behaviors, including archives longer than the first page. |
| QR sizing | `src/components/qr-canvas.tsx:34` caps backing resolution at 3x. Lines 38-39 restore the requested CSS size after QR rendering; line 74 supplies that same size initially. | Default display size stays 220 px while a 3x device uses a 660 px backing canvas. This is a correction to the existing shared renderer, with the current branded QR geometry retained. |
| Retention width and records | `src/app/portal/events/page.tsx:71` constrains the main grid. `src/components/retention-history.tsx:186` retains the category chart and line 219 renders WeeklyBars. `src/components/retention-charts.tsx:195` limits the week-label cadence; lines 198 and 233 use zero-minimum tracks. | Every week remains present in the school-year chart. At most six week labels accompany the full bar set; each bar retains its date and points title at line 214. The existing term summary, Progress/Pie/Bar race controls, category history, cumulative chart and ledger meaning continue. The retention brief already records the correction. |
| Ments touch and expanded view | `src/app/portal/ments/ments-tree.tsx:92` continues dragging with the remaining pointer. Lines 154 onward anchor pinch zoom to the midpoint; line 187 safely passes pointer cleanup events. Lines 99-106 toggle the native modal top layer and focus the fullscreen control; line 147 handles Escape and available-viewport sizing. Only the canvas has `touch-none` at line 153. | The same tree and selection remain in inline and expanded views. Two fingers zoom, one remaining finger pans, and page touch behavior is preserved outside the canvas. Exit and Escape restore focus. Fullscreen is the existing canvas expanded in a native modal viewport. The Ments brief already states this behavior. |
| Existing member navigation | DESIGN.md member navigation and plus-sheet commitments; portal shell source places MemberCodeCard before Create event and the remaining actions. Mobile captures show Home, Calendar, Retention and Profile. | The four bottom destinations and expanded QR-first plus menu continue. This change does not promote new navigation or surface-specific layout decisions into global system rules. |

## Render and verification evidence

Opened all ten current captures under this review directory: `home-desktop.png`, `home-mobile.png`, `home-user-320.png`, `retention-desktop.png`, `retention-mobile.png`, `retention-user-320.png`, `ments-desktop.png`, `ments-mobile.png`, `ments-expanded-desktop.png` and `ments-expanded-mobile.png`. The page captures show their document tops and named surfaces. The expanded captures show the modal viewport. No malformed capture was observed in this documentation comparison. The 320/390 px retention captures keep the full-school-year report and weekly bar set inside the page width.

Read `finish-review.md`: `disposition: ship`, with persistence, fidelity, ceiling, material_fixes and keep sections. The review reports no material fixes for the requested extension. It was a fresh separate review using the degraded finish-reviewer contract because the dedicated reviewer role was unavailable. This document preserves that disclosed scope and method rather than treating it as a hardware or deployment certification. `detector.json` contains no findings.

Read the relevant checks in `e2e/member-workspace-mobile.spec.ts`: 101 historical events plus an approved upcoming and pending event, all three retention views at 320/390/430/844/1440 px, native modal expansion and focus restoration, Chromium pinch followed by remaining-finger pan and person selection with an empty page-error list, and the 220/660 px high-DPI QR assertion.

Final results reported by the build owner: 16 browser regression passes and 2 WebKit skips for Chromium CDP-only gestures, plus 2 high-DPI QR passes across both engines. After the pointer-cleanup correction, the built-server fullscreen and gesture checks passed again with 3 passes and 1 WebKit CDP skip. Final lint has zero errors and two known pre-existing warnings. The production build completed, including the OpenNext Worker bundle. Tests, builds and lint were not rerun by this documenter.

The reviewed screenshots are light-mode browser evidence. Physical iPhone multitouch and a dense live forest remain untested. No new shipping raster asset was introduced; these PNGs are review evidence. Release execution remains outside this documentation handoff.

## Pre-existing drift preserved

- DESIGN.md has no token-bearing YAML frontmatter and retains older noncanonical section names. Its Interface system section and current source still identify the incumbent palette, typography and primitives for this comparison.
- DESIGN.md still describes a member demo and says authentication is not wired, including its Current prototype section. Current Home source resolves an actor, redirects missing actors and loads repository data. This older product wording was not rewritten.
- `.impeccable/design.json` is absent. An ordinary local extension does not authorize recreating the global sidecar or refreshing the whole system.
- `.impeccable/config.json` lacks `buildPath`. The existing configuration gap was reported, without repair.

## Source freshness and preservation

MCP index status succeeded during this handoff and confirmed `code-nest` ready at generation `2026-09-15T06:37:48Z`. The bounded graph search returned the known Home, retention, shell and QR symbols without remaining pagination. An inbound QR trace checked the shared-renderer relationships; current MemberCodeCard source confirms the member QR path. Coverage metadata is stale for changed sources, new component/brief/capture paths are untracked, E2E is excluded, and CSS has partial parse coverage at lines 3-5. Current exact-file reads, including that CSS range and excluded test source, govern the comparison. The scoped graphify query returned only older contextual nodes and did not establish the new behavior. No exhaustive graph-completeness claim is made.

DESIGN.md SHA-256 before and after this documentation pass is identical: `610c13e21ded0361a159a4e7427361a5ca8dbe733b22ad54fb59582c9e28ae13`. Recheck this documentation if the reviewed source changes later.

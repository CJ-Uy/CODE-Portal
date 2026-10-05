---
version: 1
slug: "src-app-portal-admin-email"
primary_target: "src/app/portal/admin/email"
related_targets: ["src/components/email"]
---

# Email workspace

Mode: Operate. Extend the existing CODE email editor and renderer. The user wants useful ready-made templates and actual recipient previews with corrections for missing or wrong merge fields. Corrections belong to one email, not member profiles.

Direction: a searchable starter gallery with previews and named use cases; one click opens editable content. Within the composer, a dedicated personalization step lists the complete receiving audience with search, missing-field filter and pagination. Selecting a person reveals the exact subject, values and message preview. Local overrides save with the draft and are used in dispatch, tests and the member archive. Keep opt-outs and outside-recipient rules intact. Accept {{firstname}} as an alias of {{first_name}}.

Follow-up requirements: add a CODE Portal major feature announcement starter using CODE Mail as its editable example. Image blocks accept public PNG, JPG, WebP and GIF uploads up to 5 MB as well as URLs, with alt text and optional links. The account allowance tooltip explains 3,000 included messages per billing cycle, US$0.35 per additional 1,000, and an hourly refreshed PHP estimate. The workspace calendar-month counter and daily cap have separate labels. Activate email and Ments on staged after the approved schema and chart import; configure distinct beta and staged reply inboxes on the shared ateneocode.org sending domain.

Research inspected: [Podia gallery](https://mobbin.com/screens/f312d96d-1ffd-40be-92da-87c2770690ae), [Squarespace preview](https://mobbin.com/screens/ed0eda9d-16fb-4321-bf51-43d8eeb45fb2), [HubSpot template use cases](https://mobbin.com/screens/2c0e2074-9651-4df1-a23f-59d91ff754e4), [Salesforce layouts](https://mobbin.com/screens/b3eb1d7a-ab8e-485c-8e61-2aa4eab35f1a). Use visual previews and purpose labels within the existing palette, without new dependencies or invented event details.

Finish requires audience and dispatch tests, mobile and desktop previews, review and scoped documentation. No real email sends during interface review.

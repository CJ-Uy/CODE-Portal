---
version: 1
slug: "src-app-portal-admin"
primary_target: "src/app/portal/admin"
related_targets: ["src/components/portal/portal-shell.tsx","src/components/portal/admin-intro.tsx"]
---

# Admin workspace

Mode: Operate. Scope: the beta admin overview, group landings, page introductions, desktop navigation, mobile navigation and breadcrumbs. Existing CODE branding and permission boundaries govern the work.

## Direction contract

THESIS: Make an administrator's next task easy to find. Replace the undifferentiated card directory with grouped, searchable rows and keep the current section visible.

OWN-WORLD: Preserve the navy CODE rail, white working surfaces, light blue selection, Unna headings and Source Sans controls. Use existing tokens and UI primitives. Borders separate content; decoration stays quiet.

STORY: Enter the overview, find a tool by its task or section, complete the work, and return through linked ancestors. Only permitted tools appear.

FIRST VIEWPORT: A compact breadcrumb bar sits above a clear Admin heading and short purpose. A tool search and section filters lead into two columns of task lists on desktop and one on mobile. The rail shows five expandable sections, an overview link and a portal return.

FORM: Extend the established CODE workspace with a task directory and native disclosure navigation. No replacement brand or image comp. The signature interaction is filtering tools in place, with a clear empty state and reset.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Research

- [Navattic settings](https://mobbin.com/screens/b346b0f3-d93f-4835-a24f-b72803d3f7ab): breadcrumb above the task, grouped sidebar, restrained active selection.
- [ElevenLabs workspace settings](https://mobbin.com/screens/bc161aca-52ed-478b-a01f-c1a5c8f661c8): readable setting rows and right-aligned actions.
- [Jira role editing](https://mobbin.com/flows/4a50b54b-a720-40d8-962e-16d7ed55fc7f): stable hierarchy across list and editing states.
- Also inspected Square, Zoho CRM, Google Workspace, Salesforce, Mural, Sketch and Copy.ai through Mobbin previews.

Quality bar: clear headings; breadcrumb current item at every route depth; keyboard-operable disclosure navigation; scoped and feature-gated tool lists; no horizontal page overflow at 390, 1265 and 1440 pixels. No backend or database change is needed.

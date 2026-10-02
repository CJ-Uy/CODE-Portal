import { describe, expect, it } from "vitest";
import type { EmailBlock } from "./types";
import { escapeHtml, pillResolver, renderBlockHtml, renderEmail, valueResolver } from "./render";

const values = { first_name: "<b>Eve</b>", full_name: "Eve", nickname: "Eve", batch: "2027", email: "eve@x.com" };
const footer = {
	categoryName: "Newsletter",
	required: false,
	archiveUrl: "https://beta.ateneocode.org/portal/mail/edl_1",
	preferencesUrl: "https://beta.ateneocode.org/portal/mail/preferences",
	unsubscribeUrl: "https://beta.ateneocode.org/unsubscribe?t=abc",
};
const blocks: EmailBlock[] = [
	{ id: "h", type: "heading", props: { text: "Hello {{first_name}}", level: 1 } },
	{ id: "t", type: "text", props: { text: "Read **this** and [the guide](https://x.com/a?b=1&c=2).\n\nNew paragraph <script>" } },
	{ id: "b", type: "button", props: { label: "RSVP", href: "https://x.com/rsvp" } },
	{ id: "e", type: "event", props: { eventId: "evt_1", title: "GA", when: "Oct 5, 9:00 AM", place: "Room 1", path: "/portal/calendar/evt_1" } },
];

function render(overrides: Partial<Parameters<typeof renderEmail>[0]> = {}) {
	return renderEmail({
		subject: "Hi {{first_name}}",
		preheader: "Quick update",
		blocks,
		resolve: valueResolver(values),
		values,
		baseUrl: "https://beta.ateneocode.org",
		footer,
		...overrides,
	});
}

describe("renderEmail", () => {
	it("escapes merge values and author text", () => {
		const { html } = render();
		expect(html).toContain("Hello &lt;b&gt;Eve&lt;/b&gt;");
		expect(html).toContain("New paragraph &lt;script&gt;");
		expect(html).not.toContain("<script>");
	});

	it("renders inline marks and https links only", () => {
		const { html } = render();
		expect(html).toContain("<strong>this</strong>");
		expect(html).toContain('href="https://x.com/a?b=1&amp;c=2"');
	});

	it("merges the subject with raw values for the subject line", () => {
		expect(render().subject).toBe("Hi <b>Eve</b>");
	});

	it("puts the preheader in a hidden span", () => {
		expect(render().html).toMatch(/display:none[^>]*>Quick update/);
	});

	it("links the event block to the absolute portal URL", () => {
		expect(render().html).toContain('href="https://beta.ateneocode.org/portal/calendar/evt_1"');
	});

	it("shows unsubscribe only for optional categories", () => {
		expect(render().html).toContain("Unsubscribe from Newsletter");
		const required = render({ footer: { ...footer, required: true, unsubscribeUrl: null } });
		expect(required.html).not.toContain("Unsubscribe");
		expect(required.html).toContain("Email preferences");
	});

	it("builds a plain-text alternative with link targets", () => {
		const { text } = render();
		expect(text).toContain("Hello <b>Eve</b>");
		expect(text).toContain("RSVP: https://x.com/rsvp");
		expect(text).toContain("the guide (https://x.com/a?b=1&c=2)");
		expect(text).toContain("Unsubscribe: https://beta.ateneocode.org/unsubscribe?t=abc");
	});
});

describe("renderBlockHtml", () => {
	it("shows tags as pills in editor mode", () => {
		const html = renderBlockHtml(blocks[0], pillResolver, "https://beta.ateneocode.org");
		expect(html).toContain("data-merge-tag=\"first_name\"");
	});
});

describe("escapeHtml", () => {
	it("escapes the five HTML characters", () => {
		expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
	});
});

import { expect, it } from "vitest";
import { emailContentSchema } from "./blocks";
import { emailStarters } from "./starters";
import { SAMPLE_MERGE_VALUES } from "./merge";
import { renderEmail, valueResolver } from "./render";

it("ships eight editable, valid CODE starters with working personalizations and links", () => {
	const starters = emailStarters("https://beta.ateneocode.org");
	expect(starters).toHaveLength(8);
	expect(new Set(starters.map((t) => t.id)).size).toBe(8);
	for (const starter of starters) {
		emailContentSchema.parse(starter);
		expect(new Set(starter.blocks.map((b) => b.id)).size).toBe(starter.blocks.length);
		const rendered = renderEmail({ ...starter, values: SAMPLE_MERGE_VALUES, resolve: valueResolver(SAMPLE_MERGE_VALUES), baseUrl: "https://beta.ateneocode.org", footer: { categoryName: "CODE", required: true, archiveUrl: null, preferencesUrl: "https://beta.ateneocode.org/portal/mail/preferences", unsubscribeUrl: null } });
		expect(rendered.subject).not.toContain("{{");
		expect(rendered.html).not.toContain("{{");
		expect(rendered.html).toContain("code-logo-full-navy.png");
	}
});

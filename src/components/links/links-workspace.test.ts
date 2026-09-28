import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { LinkListItem } from "@/db/repositories/links";
import { ORG_QR_STYLE } from "./qr-style";
import { LinksWorkspace } from "./links-workspace";

it("keeps link actions visible in the mobile list", () => {
	const link: LinkListItem = {
		id: "demo-1",
		slug: "join",
		destinationUrl: "https://example.com/join",
		title: "Membership form",
		ownerMemberId: "member-1",
		clickCount: 12,
		previewTitle: null,
		previewDescription: null,
		previewImageKey: null,
		tags: [],
		qrStyle: ORG_QR_STYLE,
		createdAt: new Date("2026-09-28T00:00:00Z"),
		updatedAt: new Date("2026-09-28T00:00:00Z"),
		owner: { id: "member-1", name: "Member", image: null },
	};
	const html = renderToStaticMarkup(createElement(LinksWorkspace, {
		initialLinks: [link], actorMemberId: "member-1", canModerate: false,
	}));
	expect(html).toContain('class="grid gap-2 md:hidden"');
	expect(html).toContain('aria-label="Copy Membership form short link"');
	expect(html).toContain('aria-label="View Membership form details and QR code"');
	expect(html.match(/aria-label="Delete Membership form"/g)).toHaveLength(2);
	expect(html).toContain("Showing all 1 link.");
});

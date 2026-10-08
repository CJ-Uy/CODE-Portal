import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { LinkListItem } from "@/db/repositories/links";
import { ORG_QR_STYLE } from "./qr-style";
import { LinksWorkspace } from "./links-workspace";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ replace: vi.fn() }),
	useSearchParams: () => new URLSearchParams(),
}));

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
		initialPage: { links: [link], total: 1, tags: [] }, actorMemberId: "member-1", canModerate: false,
	}));
	expect(html).toContain('class="grid gap-2 2xl:hidden"');
	expect(html).toContain('aria-label="Copy Membership form short link"');
	expect(html).toContain('aria-label="View Membership form details and QR code"');
	expect(html.match(/aria-label="Delete Membership form"/g)).toHaveLength(2);
	expect(html).toContain("Showing 1–1 of 1 link");
});

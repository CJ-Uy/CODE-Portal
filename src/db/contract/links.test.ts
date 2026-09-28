import { describe, expect, it } from "vitest";
import { linkStatsInputSchema, linksContract, updateLinkInputSchema } from "./links";

describe("linksContract", () => {
	it("marks read operations as shared-dev allowed and mutations as denied", () => {
		expect(linksContract.listOwn.sharedDev).toBe("allow");
		expect(linksContract.listAll.permission).toBe("link:moderate");
		expect(linksContract.create.sharedDev).toBe("deny");
		expect(linksContract.update.sharedDev).toBe("deny");
		expect(linksContract.remove.sharedDev).toBe("deny");
		expect(linksContract.stats.sharedDev).toBe("allow");
	});

	it("parses nullable preview fields on update", () => {
		const parsed = updateLinkInputSchema.parse({
			id: "lnk_1",
			previewTitle: null,
			previewDescription: "Short preview",
			previewImageKey: null,
		});
		expect(parsed).toMatchObject({ id: "lnk_1", previewTitle: null, previewImageKey: null });
	});

	it("validates QR style additions and defaults analytics filters", () => {
		const update = updateLinkInputSchema.parse({
			id: "lnk_1",
			qrStyle: {
				pattern: "classy-rounded",
				cornerStyle: "dot",
				showLogo: false,
				logoBackingShape: "square",
				logoBackingColor: "#FFFFFF",
				transparentBackground: true,
			},
		});
		expect(update.qrStyle).toMatchObject({ pattern: "classy-rounded", cornerStyle: "dot", transparentBackground: true });

		expect(linkStatsInputSchema.parse({ id: "lnk_1" })).toMatchObject({
			timezone: "UTC",
			granularity: "day",
			source: "all",
			device: "all",
		});
		expect(() => linkStatsInputSchema.parse({ id: "lnk_1", timezone: "Mars/Olympus" })).toThrow();
		expect(() => linkStatsInputSchema.parse({ id: "lnk_1", from: "2026-06-20", to: "2026-06-19" })).toThrow();
	});
});

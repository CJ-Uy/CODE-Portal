import { describe, expect, it, vi } from "vitest";
import { buildRedirectResponse } from "./redirect";

const link = {
	id: "lnk_1",
	slug: "welcome",
	destinationUrl: "https://example.com/dest",
	title: "Welcome",
	previewTitle: "Preview Title",
	previewDescription: "Preview Description",
	previewImageKey: "links/lnk_1/preview/img.png",
};

function deps(overrides: Record<string, unknown> = {}) {
	return {
		resolveForRedirect: vi.fn(async (slug: string) => (slug === "welcome" ? link : null)),
		recordClick: vi.fn(async () => {}),
		scheduleBackground: vi.fn((task: Promise<unknown>) => void task),
		previewImageBaseUrl: "https://app.example",
		...overrides,
	};
}

describe("buildRedirectResponse", () => {
	it("302s a normal browser and schedules a click upsert in the background", async () => {
		const d = deps();
		const res = await buildRedirectResponse(
			d,
			new Request("https://app.example/welcome", {
				headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120", referer: "https://www.google.com/" },
			}),
		);
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe("https://example.com/dest");
		expect(d.scheduleBackground).toHaveBeenCalledOnce();
		expect(d.recordClick).toHaveBeenCalledOnce();
		expect(d.recordClick).toHaveBeenCalledWith("lnk_1", expect.objectContaining({ hour: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/) }));
	});

	it.each([
		["?source=qr", "qr scan"],
		["?s=qr", "qr scan"],
		["?source=qr&s=legacy-is-ignored", "qr scan"],
		["", "direct"],
		["?source=link", "direct"],
		["?source=qr&source=qr", "direct"],
		["?source=qr&source=link", "direct"],
		["?s=qr&s=qr", "direct"],
		["?s=invalid", "direct"],
	])("classifies %s as %s", async (query, expectedBucket) => {
		const d = deps();
		await buildRedirectResponse(
			d,
			new Request(`https://app.example/welcome${query}`, {
				headers: { "user-agent": "Mozilla/5.0 (iPhone) Safari", referer: "https://www.google.com/" },
			}),
		);
		expect(d.recordClick).toHaveBeenCalledWith("lnk_1", expect.objectContaining({ referrerBucket: expectedBucket }));
	});

	it("serves OG HTML to a crawler without recording a click", async () => {
		const d = deps({
			recordClick: vi.fn(async () => {
				throw new Error("stats down");
			}),
		});
		const res = await buildRedirectResponse(
			d,
			new Request("https://app.example/welcome", { headers: { "user-agent": "facebookexternalhit/1.1" } }),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		const body = await res.text();
		expect(body).toContain('property="og:title" content="Preview Title"');
		expect(body).toContain("links%2Flnk_1%2Fpreview%2Fimg.png");
		expect(d.recordClick).not.toHaveBeenCalled();
		expect(d.scheduleBackground).not.toHaveBeenCalled();
	});

	it("404s an unknown slug", async () => {
		const d = deps();
		const res = await buildRedirectResponse(d, new Request("https://app.example/missing"));
		expect(res.status).toBe(404);
		expect(d.scheduleBackground).not.toHaveBeenCalled();
	});

	it("never throws when the background click write rejects", async () => {
		const d = deps({
			recordClick: vi.fn(async () => {
				throw new Error("stats down");
			}),
			scheduleBackground: (task: Promise<unknown>) => void task.catch(() => {}),
		});
		const res = await buildRedirectResponse(d, new Request("https://app.example/welcome", { headers: { "user-agent": "Chrome" } }));
		expect(res.status).toBe(302);
	});
});

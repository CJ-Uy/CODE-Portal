import type { ResolvedLink } from "@/db/repositories/links";
import { isCrawlerUserAgent, renderPreviewHtml } from "@/lib/crawlers";
import { deviceBucket } from "@/lib/links";

export type RedirectDependencies = {
	resolveForRedirect(slug: string): Promise<ResolvedLink | null>;
	recordClick(linkId: string, input: { date: string; hour?: string; referrerBucket: string; deviceBucket: string }): Promise<void>;
	scheduleBackground(task: Promise<unknown>): void;
	previewImageBaseUrl: string;
};

function isQrScan(params: URLSearchParams): boolean {
	const canonical = params.getAll("source");
	if (canonical.length > 0) return canonical.length === 1 && canonical[0] === "qr";
	const legacy = params.getAll("s");
	return legacy.length === 1 && legacy[0] === "qr";
}

export async function buildRedirectResponse(deps: RedirectDependencies, request: Request, routeSlug?: string): Promise<Response> {
	const requestUrl = new URL(request.url);
	const slug = routeSlug ?? requestUrl.pathname.replace(/^\//, "");
	const link = await deps.resolveForRedirect(slug);
	if (!link) return new Response("Not found", { status: 404 });

	const userAgent = request.headers.get("user-agent");
	if (isCrawlerUserAgent(userAgent)) {
		const imageUrl = link.previewImageKey
			? new URL(`/api/uploads/${encodeURIComponent(link.previewImageKey)}`, deps.previewImageBaseUrl).toString()
			: null;
		const html = renderPreviewHtml({
			title: link.previewTitle ?? link.title,
			description: link.previewDescription,
			imageUrl,
			destinationUrl: link.destinationUrl,
		});
		return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
	}

	const clickedAtIso = new Date().toISOString();
	deps.scheduleBackground(
		deps
			.recordClick(link.id, {
				date: clickedAtIso.slice(0, 10),
				hour: clickedAtIso.slice(0, 13) + ":00",
				referrerBucket: isQrScan(requestUrl.searchParams) ? "qr scan" : "direct",
				deviceBucket: deviceBucket(userAgent),
			})
			.catch(() => {}),
	);

	return new Response(null, { status: 302, headers: { location: link.destinationUrl } });
}

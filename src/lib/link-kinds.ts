import type { navPinIcons } from "@/components/portal/nav-pin-icons";

// The type an important link shows members. Admins can set one; otherwise it is detected from the URL.
export const LINK_KINDS = ["sheet", "doc", "slides", "form", "folder", "video", "site"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_KIND_LABELS: Record<LinkKind, string> = {
	sheet: "Spreadsheet",
	doc: "Document",
	slides: "Slides",
	form: "Form",
	folder: "Folder",
	video: "Video",
	site: "Website",
};

// Names in src/components/portal/nav-pin-icons.ts, so the sidebar (a client component) can take them as plain strings.
export const LINK_KIND_ICONS = {
	sheet: "FileSpreadsheet",
	doc: "FileText",
	slides: "Presentation",
	form: "ClipboardList",
	folder: "Folder",
	video: "Video",
	site: "Globe",
} as const satisfies Record<LinkKind, keyof typeof navPinIcons>;

const officeLetters: Record<string, LinkKind> = { x: "sheet", w: "doc", p: "slides", f: "folder" };
const officeApps: Record<string, LinkKind> = { excel: "sheet", word: "doc", powerpoint: "slides" };

export function detectLinkKind(url: string): LinkKind {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return "site";
	}
	const host = parsed.hostname.toLowerCase().replace(/^(www|m)\./, "");
	const path = parsed.pathname.toLowerCase();

	if (host === "docs.google.com") {
		if (path.startsWith("/spreadsheets/")) return "sheet";
		if (path.startsWith("/document/")) return "doc";
		if (path.startsWith("/presentation/")) return "slides";
		if (path.startsWith("/forms/")) return "form";
	}
	if (host === "forms.gle" || host === "forms.office.com" || host === "forms.microsoft.com") return "form";
	if (host === "drive.google.com" && path.includes("/folders/")) return "folder";

	// SharePoint and OneDrive share links carry the file type: /:x:/ on SharePoint, 1drv.ms/x/ when shortened,
	// and ?app=Excel on onedrive.live.com.
	const letter = host.endsWith("sharepoint.com") ? /^\/:([a-z]):\//.exec(path)?.[1] : host === "1drv.ms" ? /^\/([a-z])\//.exec(path)?.[1] : undefined;
	if (letter && officeLetters[letter]) return officeLetters[letter];
	const app = officeApps[parsed.searchParams.get("app")?.toLowerCase() ?? ""];
	if (host === "onedrive.live.com" && app) return app;

	if (/\.(xlsx?|xlsm|csv)$/.test(path)) return "sheet";
	if (/\.(docx?|pdf)$/.test(path)) return "doc";
	if (/\.pptx?$/.test(path)) return "slides";
	if (host === "youtube.com" || host === "youtu.be" || host === "vimeo.com") return "video";
	return "site";
}

export function isLinkKind(value: unknown): value is LinkKind {
	return (LINK_KINDS as readonly unknown[]).includes(value);
}

export function linkKindOf(link: { kind: string | null; url: string }): LinkKind {
	return isLinkKind(link.kind) ? link.kind : detectLinkKind(link.url);
}

/** The site a link opens, shown so members know where they are going before they tap. */
export function linkHost(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

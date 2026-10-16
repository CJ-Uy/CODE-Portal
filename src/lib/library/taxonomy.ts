/**
 * Library vocabulary and the normalizers the seed import uses to turn messy sheet
 * cells into it. Pure and dependency-free so the DB schema can `import type` from here.
 */
export const LIBRARY_KINDS = [
	"code_document",
	"template",
	"framework",
	"guide",
	"article",
	"case_study",
	"reading",
	"website",
] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];
export type LibraryFormat = "file" | "page" | "link";
export type LibrarySource = "code" | "member" | "outside";
export type LibraryStatus = "draft" | "pending_review" | "published" | "taken_down";
export type LibraryPublicReadiness = "not_eligible" | "needs_adapting" | "public_ready";
export type LibraryAuthor = { name: string; memberId?: string };

export const KIND_LABELS: Record<LibraryKind, string> = {
	code_document: "Module/IDF",
	template: "Template",
	framework: "Framework",
	guide: "Guide",
	article: "Article",
	case_study: "Case study",
	reading: "Book/paper",
	website: "Website",
};

export const SOURCE_LABELS: Record<LibrarySource, string> = {
	code: "Made by CODE",
	member: "From members",
	outside: "From outside",
};

export function defaultFormat(kind: LibraryKind): LibraryFormat {
	if (kind === "code_document" || kind === "template" || kind === "reading") return "file";
	return kind === "website" ? "link" : "page";
}

export function defaultSource(kind: LibraryKind): LibrarySource {
	if (kind === "article") return "member";
	return kind === "reading" || kind === "website" ? "outside" : "code";
}

export function defaultPublicReadiness(kind: LibraryKind): LibraryPublicReadiness | null {
	return kind === "reading" || kind === "website" ? "not_eligible" : null;
}

export const SUBTYPES = {
	code_document: ["IDF", "Module", "Topic Resource"],
	reading: ["Book", "Academic Article", "Report", "Other"],
} as const;

export const FORMAT_DETAILS = [
	"SLE",
	"Lectivity",
	"Reflectivity",
	"Lecture",
	"Reflecture",
	"FGD",
	"Activity",
	"Consultation Session",
	"Simulation",
	"Learning Circle",
	"Other",
] as const;

export const ENGAGEMENT_TYPES = ["STE", "LTE", "C-Team"] as const;

export const TAG_GROUPS: readonly { group: string; tags: readonly string[] }[] = [
	{
		group: "Direction & Strategy",
		tags: ["Vision & Mission (VMOS)", "Strategic Planning", "Goal Setting", "Alignment", "Advocacy"],
	},
	{
		group: "Structure & Systems",
		tags: [
			"Org Design",
			"Processes, Systems & Structures (PSS)",
			"Constitution & Internal Rules",
			"Roles & Responsibilities",
			"Systems Thinking",
		],
	},
	{
		group: "Diagnosis & Change",
		tags: ["Diagnosis", "Change Management", "Root Cause Analysis", "Monitoring & Evaluation", "Stakeholder Analysis"],
	},
	{
		group: "People & Culture",
		tags: [
			"Org Culture",
			"Member Engagement",
			"Motivation",
			"Teamwork & Collaboration",
			"Accountability",
			"Communication & Feedback",
			"Well-being & Burnout",
			"Diversity & Inclusion",
		],
	},
	{
		group: "Leadership",
		tags: ["Leadership", "Self-Awareness & Growth", "Transitions & Turnover"],
	},
	{
		group: "Methods",
		tags: [
			"Design Thinking / HCD",
			"Design Sprint",
			"Behavioral Design",
			"Facilitation",
			"Appreciative Inquiry",
			"Ideation",
			"Project Management",
			"Module Design",
			"Problem Solving",
		],
	},
	{
		group: "Member Writing",
		tags: ["Tech & Digital Tools", "Career & Skills"],
	},
];

/**
 * A format matches when the text starts with it and the next character is not a
 * letter: "Lecture Workship" is a Lecture, but "SLExtivity" is a compound, not an SLE.
 */
function matchFormat(token: string): (typeof FORMAT_DETAILS)[number] | undefined {
	const lower = token.toLowerCase();
	return FORMAT_DETAILS.find((f) => {
		const prefix = f.toLowerCase();
		return lower.startsWith(prefix) && !/[a-z]/.test(lower.charAt(prefix.length));
	});
}

const DOC_TYPE = /^\s*(idf|topic resource|module)\b[\s:]*([\s\S]*)$/i;

/**
 * Sheet "document type" cell, e.g. "Module: Lecture, SLE" or "IDF: Anything".
 * A bare recognised format ("Lectivity") is a Module. Anything else bare gets no subtype.
 */
export function normalizeDocType(raw: string): {
	subtype: "IDF" | "Module" | "Topic Resource" | null;
	formatDetail: string | null;
	extraFormats: string[];
} {
	const none = { subtype: null, formatDetail: null, extraFormats: [] };
	const m = DOC_TYPE.exec(raw);
	const head = m?.[1]?.toLowerCase();
	if (head === "idf") return { ...none, subtype: "IDF" };
	if (head === "topic resource") return { ...none, subtype: "Topic Resource" };

	const tokens = (m?.[2] ?? raw)
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	const first = tokens[0];
	if (first === undefined) return m ? { ...none, subtype: "Module" } : none;

	const formatDetail = matchFormat(first) ?? (m ? "Other" : null);
	if (formatDetail === null) return none;
	const extras = tokens.slice(1).flatMap((t) => matchFormat(t) ?? []);
	return {
		subtype: "Module",
		formatDetail,
		extraFormats: [...new Set(extras)].filter((f) => f !== formatDetail),
	};
}

export function normalizeEngagementType(raw: string | null | undefined): "STE" | "LTE" | "C-Team" | null {
	const key = raw?.trim().toLowerCase();
	return ENGAGEMENT_TYPES.find((t) => t.toLowerCase() === key) ?? null;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Splits a topics cell on `,` `;` and newlines, except inside known phrases (which
 * contain commas themselves). Known phrases match case-insensitively and come back
 * in their canonical form. Order of first appearance, case-insensitively de-duplicated.
 */
export function splitTopics(raw: string, knownPhrases: readonly string[]): string[] {
	// Longest first, so a phrase that contains another wins at the same position.
	const phrases = knownPhrases.filter((p) => p.trim()).sort((a, b) => b.length - a.length);
	let text = raw.replace(/\0/g, "");
	if (phrases.length > 0) {
		const known = new RegExp(phrases.map(escapeRegExp).join("|"), "gi");
		text = text.replace(known, (hit) => `\0${phrases.findIndex((p) => p.toLowerCase() === hit.toLowerCase())}\0`);
	}

	const seen = new Set<string>();
	const topics: string[] = [];
	for (const part of text.split(/[,;\n]/)) {
		const topic = part.trim().replace(/\0(\d+)\0/g, (_, i) => phrases[Number(i)] ?? "");
		if (topic && !seen.has(topic.toLowerCase())) {
			seen.add(topic.toLowerCase());
			topics.push(topic);
		}
	}
	return topics;
}

/** CODEr authors are "First Last" so commas separate them; reading authors are "Last, First" so only newlines do. */
export function splitAuthors(raw: string, kind: "code_document" | "reading"): string[] {
	return raw
		.split(kind === "reading" ? "\n" : /[,\n]/)
		.map((a) => a.trim())
		.filter(Boolean);
}

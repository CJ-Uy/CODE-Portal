import { z } from "zod";
import { operation } from "./common";

export const qrStyleSchema = z.object({
	foreground: z.string().regex(/^#[0-9a-f]{6}$/i),
	background: z.string().regex(/^#[0-9a-f]{6}$/i),
	pattern: z.enum(["classic", "rounded", "dots", "soft", "classy", "classy-rounded"]),
	cornerStyle: z.enum(["square", "rounded", "dot"]),
	showLogo: z.boolean(),
	logoUrl: z.string().nullable(),
	logoSize: z.number().min(0.1).max(0.35),
	logoMargin: z.number().min(0).max(24),
	showLogoBacking: z.boolean(),
	logoBackingShape: z.enum(["circle", "square"]),
	logoBackingColor: z.string().regex(/^#[0-9a-f]{6}$/i),
	transparentBackground: z.boolean(),
});

export const linkOutputSchema = z.object({
	id: z.string(),
	slug: z.string(),
	destinationUrl: z.string(),
	title: z.string(),
	ownerMemberId: z.string(),
	clickCount: z.number().int(),
	previewTitle: z.string().nullable(),
	previewDescription: z.string().nullable(),
	previewImageKey: z.string().nullable(),
	tags: z.string().nullable(),
	qrStyle: z.string().nullable(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
});

export const linkOwnerSchema = z.object({ id: z.string(), name: z.string().nullable(), image: z.string().nullable() });
export const linkListItemSchema = linkOutputSchema.omit({ tags: true, qrStyle: true }).extend({
	owner: linkOwnerSchema.nullable(),
	tags: z.array(z.string()),
	qrStyle: qrStyleSchema,
});

const tagsInputSchema = z.array(z.string().trim().min(1).max(24)).max(10);
const qrStyleInputSchema = qrStyleSchema.partial();

export const createLinkInputSchema = z.object({
	slug: z.string().trim().min(1).max(64),
	destinationUrl: z.string().trim().url().max(2048),
	title: z.string().trim().min(1).max(120),
	tags: tagsInputSchema.optional(),
	qrStyle: qrStyleInputSchema.optional(),
});

export const updateLinkInputSchema = z.object({
	id: z.string().min(1),
	destinationUrl: z.string().trim().url().max(2048).optional(),
	title: z.string().trim().min(1).max(120).optional(),
	previewTitle: z.string().trim().max(120).nullable().optional(),
	previewDescription: z.string().trim().max(300).nullable().optional(),
	previewImageKey: z.string().trim().max(256).nullable().optional(),
	tags: tagsInputSchema.optional(),
	qrStyle: qrStyleInputSchema.optional(),
});

export const linkStatsOutputSchema = z.object({
	link: linkOutputSchema,
	lifetimeClicks: z.number().int().nonnegative(),
	filteredClicks: z.number().int().nonnegative(),
	series: z.array(z.object({ date: z.string(), count: z.number().int() })),
	hourly: z.array(z.object({ hour: z.string(), count: z.number().int() })),
	referrers: z.array(z.object({ bucket: z.string(), count: z.number().int() })),
	devices: z.array(z.object({ bucket: z.string(), count: z.number().int() })),
	query: z.object({
		from: z.string(),
		to: z.string(),
		timezone: z.string(),
		granularity: z.enum(["hour", "day", "week", "month"]),
		source: z.enum(["all", "qr", "link", "unknown"]),
		device: z.enum(["all", "mobile", "desktop"]),
	}),
	comparison: z.object({
		from: z.string(),
		to: z.string(),
		filteredClicks: z.number().int().nonnegative(),
	}),
	history: z.object({
		basis: z.literal("hourly"),
		earliestHour: z.string().nullable(),
		latestHour: z.string().nullable(),
		rowsRead: z.number().int().nonnegative(),
		maxRows: z.number().int().positive(),
		complete: z.boolean(),
		note: z.string().nullable(),
	}),
});

const analyticsDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must use YYYY-MM-DD.");
const timezoneSchema = z.string().min(1).max(100).refine((timezone) => {
	try {
		new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
		return true;
	} catch {
		return false;
	}
}, "Timezone must be a valid IANA timezone.");

export const linkStatsInputSchema = z.object({
	id: z.string().min(1),
	from: analyticsDateSchema.optional(),
	to: analyticsDateSchema.optional(),
	timezone: timezoneSchema.default("UTC"),
	granularity: z.enum(["hour", "day", "week", "month"]).default("day"),
	source: z.enum(["all", "qr", "link", "unknown"]).default("all"),
	device: z.enum(["all", "mobile", "desktop"]).default("all"),
}).refine((input) => !input.from || !input.to || input.from <= input.to, {
	message: "Analytics start date must be on or before the end date.",
	path: ["from"],
});

export function linkStatsInputFromUrl(request: Request, id: string) {
	const params = new URL(request.url).searchParams;
	return linkStatsInputSchema.parse({
		id,
		from: params.get("from") ?? undefined,
		to: params.get("to") ?? undefined,
		timezone: params.get("timezone") ?? undefined,
		granularity: params.get("granularity") ?? undefined,
		source: params.get("source") ?? undefined,
		device: params.get("device") ?? undefined,
	});
}

const pageInput = z.object({
	limit: z.number().int().min(1).max(50).default(25),
	offset: z.number().int().min(0).default(0),
});

export const searchLinksInputSchema = pageInput.extend({
	query: z.string().trim().max(120).default(""),
	own: z.boolean().default(false),
	tags: z.array(z.string().min(1).max(24)).max(20).default([]),
	sort: z.enum(["title", "slug", "clicks", "owner", "created"]).default("created"),
	direction: z.enum(["asc", "desc"]).default("desc"),
});

export function searchLinksInputFromUrl(url: URL) {
	return searchLinksInputSchema.parse({
		limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
		offset: url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : undefined,
		query: url.searchParams.get("query") ?? undefined,
		own: url.searchParams.get("own") === "true",
		tags: url.searchParams.getAll("tag"),
		sort: url.searchParams.get("sort") ?? undefined,
		direction: url.searchParams.get("direction") ?? undefined,
	});
}

export const linksContract = {
	searchVisible: operation({
		input: searchLinksInputSchema,
		output: z.object({ links: z.array(linkListItemSchema), total: z.number().int().nonnegative(), tags: z.array(z.string()) }),
		auth: "member",
		sharedDev: "allow",
	}),
	listVisible: operation({
		input: pageInput,
		output: z.object({ links: z.array(linkListItemSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
	listOwn: operation({
		input: pageInput,
		output: z.object({ links: z.array(linkListItemSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
	listAll: operation({
		input: pageInput,
		output: z.object({ links: z.array(linkListItemSchema) }),
		auth: "admin",
		permission: "link:moderate",
		sharedDev: "allow",
	}),
	get: operation({
		input: z.object({ id: z.string().min(1) }),
		output: z.object({ link: linkOutputSchema.nullable() }),
		auth: "member",
		sharedDev: "allow",
	}),
	create: operation({
		input: createLinkInputSchema,
		output: z.object({ link: linkListItemSchema }),
		auth: "member",
		sharedDev: "deny",
	}),
	update: operation({
		input: updateLinkInputSchema,
		output: z.object({ link: linkListItemSchema }),
		auth: "member",
		sharedDev: "deny",
	}),
	remove: operation({
		input: z.object({ id: z.string().min(1) }),
		output: z.object({}),
		auth: "member",
		sharedDev: "deny",
	}),
	stats: operation({
		input: linkStatsInputSchema,
		output: linkStatsOutputSchema,
		auth: "member",
		sharedDev: "allow",
	}),
};

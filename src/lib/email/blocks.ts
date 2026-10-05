import { z } from "zod";
import { findUnknownTags } from "./merge";
import type { EmailBlock, EmailBlockType } from "./types";

const httpsUrl = z
	.string()
	.trim()
	.max(2000)
	.refine((value) => /^https:\/\/[^\s]+$/i.test(value), "Use a link that starts with https://");
const linkUrl = z
	.string()
	.trim()
	.max(2000)
	.refine((value) => /^(https:\/\/|mailto:)[^\s]+$/i.test(value), "Use a link that starts with https:// or mailto:");

const tagged = (max: number) =>
	z
		.string()
		.max(max)
		.superRefine((value, ctx) => {
			const unknown = findUnknownTags(value);
			if (unknown.length > 0) ctx.addIssue({ code: "custom", message: `Unknown field: ${unknown.join(", ")}` });
		});

const id = z.string().min(1).max(40);

export const blockSchema = z.discriminatedUnion("type", [
	z.object({ id, type: z.literal("heading"), props: z.object({ text: tagged(200), level: z.union([z.literal(1), z.literal(2)]) }) }),
	z.object({ id, type: z.literal("text"), props: z.object({ text: tagged(5000) }) }),
	z.object({ id, type: z.literal("button"), props: z.object({ label: tagged(80), href: linkUrl }) }),
	z.object({
		id,
		type: z.literal("image"),
		props: z.object({ src: httpsUrl, alt: z.string().max(200), href: linkUrl.optional() }),
	}),
	z.object({ id, type: z.literal("divider"), props: z.object({}).strict() }),
	z.object({ id, type: z.literal("spacer"), props: z.object({ size: z.enum(["sm", "md", "lg"]) }) }),
	z.object({
		id,
		type: z.literal("event"),
		props: z.object({
			eventId: z.string().min(1),
			title: z.string().max(200),
			when: z.string().max(120),
			place: z.string().max(200),
			path: z.string().regex(/^\/portal\/calendar\/[A-Za-z0-9_-]+$/),
		}),
	}),
]);

export const blocksSchema = z.array(blockSchema).max(60);

export const emailContentSchema = z.object({
	subject: tagged(200),
	preheader: tagged(200),
	blocks: blocksSchema,
});

const ruleSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("roster"), termId: z.string().min(1) }),
	z.object({ kind: z.literal("role"), roleKey: z.string().min(1) }),
	z.object({ kind: z.literal("batch"), batch: z.string().min(1).max(40) }),
	z.object({ kind: z.literal("status"), status: z.enum(["active", "pending", "inactive"]) }),
	z.object({ kind: z.literal("event"), eventId: z.string().min(1), relation: z.enum(["rsvp", "attended", "no_show"]) }),
	z.object({ kind: z.literal("member"), memberId: z.string().min(1) }),
	z.object({ kind: z.literal("emails"), emails: z.array(z.string().trim().toLowerCase().email()).min(1).max(1000) }),
]);

export const audienceSchema = z.object({
	match: z.enum(["all", "any"]),
	include: z.array(ruleSchema).max(100),
	exclude: z.array(ruleSchema).max(100),
});

const blockId = () => `blk_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;

/** Default content for a block added from the palette. */
export function newBlock(type: Exclude<EmailBlockType, "event">): EmailBlock {
	switch (type) {
		case "heading":
			return { id: blockId(), type, props: { text: "Heading", level: 1 } };
		case "text":
			return { id: blockId(), type, props: { text: "Hi {{first_name}}," } };
		case "button":
			return { id: blockId(), type, props: { label: "Open the portal", href: "https://beta.ateneocode.org/portal" } };
		case "image":
			return { id: blockId(), type, props: { src: "https://beta.ateneocode.org/code-doc-cover.png", alt: "" } };
		case "divider":
			return { id: blockId(), type, props: {} };
		case "spacer":
			return { id: blockId(), type, props: { size: "md" } };
	}
}

export function newEventBlock(props: { eventId: string; title: string; when: string; place: string }): EmailBlock {
	return { id: blockId(), type: "event", props: { ...props, path: `/portal/calendar/${props.eventId}` } };
}

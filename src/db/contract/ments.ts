import { z } from "zod";
import { operation } from "./common";

export const mentsPersonSchema = z.object({
	id: z.string(),
	name: z.string(),
	cohort: z.string().nullable(),
	memberId: z.string().nullable(),
	mentorId: z.string().nullable(),
});
export type MentsPerson = z.infer<typeof mentsPersonSchema>;
export const mentsAdminPersonSchema = mentsPersonSchema.extend({ memberEmail: z.string().nullable() });
export type MentsAdminPerson = z.infer<typeof mentsAdminPersonSchema>;

export const mentsInputSchema = z.object({
	id: z.string().min(1).max(100).optional(),
	name: z.string().trim().min(1, "Enter a name.").max(100),
	cohort: z.string().trim().max(40).nullable(),
	mentorId: z.string().min(1).max(100).nullable(),
	memberEmail: z.string().trim().toLowerCase().email().max(254).nullable(),
});
export type MentsInput = z.infer<typeof mentsInputSchema>;

export const pmentReportSchema = z.object({ memberId: z.string(), memberName: z.string(), personId: z.string() });
export type PmentReport = z.infer<typeof pmentReportSchema>;
const pmentsInput = z.object({ personIds: z.array(z.string().min(1).max(100)).max(10, "Choose up to 10 Pments.") });

export const mentsContract = {
	list: operation({ input: z.object({}), output: z.object({ people: z.array(mentsPersonSchema) }), auth: "member", sharedDev: "allow" }),
	manage: operation({ input: z.object({}), output: z.object({ people: z.array(mentsAdminPersonSchema) }), auth: "admin", permission: "member:manage", sharedDev: "allow" }),
	save: operation({ input: mentsInputSchema, output: z.object({ person: mentsPersonSchema }), auth: "admin", permission: "member:manage", sharedDev: "allow" }),
	remove: operation({ input: z.object({ id: z.string().min(1).max(100) }), output: z.object({ ok: z.literal(true) }), auth: "admin", permission: "member:manage", sharedDev: "allow" }),
	import: operation({ input: z.object({ raw: z.string().min(1).max(64 * 1024) }), output: z.object({ added: z.number().int(), linked: z.number().int() }), auth: "admin", permission: "member:manage", sharedDev: "allow" }),
	pments: operation({ input: z.object({}), output: z.object({ reports: z.array(pmentReportSchema) }), auth: "member", sharedDev: "allow" }),
	reportPments: operation({ input: pmentsInput, output: z.object({ ok: z.literal(true) }), auth: "member", sharedDev: "allow" }),
	removePment: operation({ input: z.object({ memberId: z.string().min(1).max(100), personId: z.string().min(1).max(100) }), output: z.object({ ok: z.literal(true) }), auth: "admin", permission: "member:manage", sharedDev: "allow" }),
};

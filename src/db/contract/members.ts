import { z } from "zod";
import { createMemberInputSchema, updateMemberProfileInputSchema } from "@/db/types";
import { operation } from "./common";

export const memberOutputSchema = z.object({
	id: z.string(),
	email: z.string().email(),
	emailVerified: z.coerce.date().nullable(),
	name: z.string().nullable(),
	image: z.string().nullable(),
	fullName: z.string().nullable(),
	nickname: z.string().nullable(),
	pronouns: z.string().nullable(),
	batch: z.string().nullable(),
	birthday: z.string().nullable(),
	birthdayPrivate: z.boolean(),
	avatarKey: z.string().nullable(),
	status: z.enum(["active", "pending", "inactive"]),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
});

export const membersContract = {
	list: operation({
		input: z.object({ limit: z.number().int().min(1).max(50).default(25) }),
		output: z.object({ members: z.array(memberOutputSchema) }),
		auth: "admin",
		permission: "member:manage",
		sharedDev: "allow",
	}),
	get: operation({
		input: z.object({ id: z.string().min(1) }),
		output: z.object({ member: memberOutputSchema.nullable() }),
		auth: "member",
		sharedDev: "allow",
	}),
	create: operation({
		input: createMemberInputSchema,
		output: z.object({ member: memberOutputSchema }),
		auth: "admin",
		permission: "member:manage",
		sharedDev: "deny",
	}),
	updateProfile: operation({
		input: updateMemberProfileInputSchema,
		output: z.object({ member: memberOutputSchema }),
		auth: "member",
		sharedDev: "allow",
	}),
};

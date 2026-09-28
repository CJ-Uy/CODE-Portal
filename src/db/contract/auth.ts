import { z } from "zod";
import { roleKeys } from "@/server/auth/permissions";
import { operation } from "./common";

export const actorOutputSchema = z.object({
	memberId: z.string(),
	roles: z.array(z.enum(roleKeys)),
	context: z.enum(["session", "shared_dev_token"]).optional(),
	sharedTokenLabel: z.string().nullable().optional(),
});

export const authContract = {
	actor: operation({
		input: z.object({}),
		output: z.object({ actor: actorOutputSchema }),
		auth: "member",
		sharedDev: "allow",
	}),
};

import { z } from "zod";
import { operation } from "./common";

export const uploadsContract = {
	put: operation({
		input: z.object({
			purpose: z.enum(["avatar", "event_media", "link_preview"]),
			contentType: z.string(),
			size: z.number().int().positive(),
		}),
		output: z.object({ key: z.string(), url: z.string().nullable() }),
		auth: "member",
		sharedDev: "deny",
	}),
	get: operation({
		input: z.object({ key: z.string().min(1) }),
		output: z.object({ contentType: z.string().optional() }),
		auth: "member",
		sharedDev: "allow",
	}),
	delete: operation({
		input: z.object({ key: z.string().min(1) }),
		output: z.object({}),
		auth: "member",
		sharedDev: "deny",
	}),
};

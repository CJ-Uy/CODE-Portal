"use server";

import { z } from "zod";
import { applyTokenOptOut } from "@/db/repositories/email-member";
import { runAction } from "@/lib/email/action-result";
import { emailConfigFromEnv, emailDbFromEnv } from "@/server/email/db";
import { verifyUnsubscribeToken } from "@/server/email/unsubscribe-token";
import { assertFeatureEnabled } from "@/server/features";

export async function unsubscribeAction(token: string, optedOut: boolean) {
	return runAction(async () => {
		assertFeatureEnabled("email");
		const payload = await verifyUnsubscribeToken(emailConfigFromEnv().unsubscribeSecret, z.string().max(400).parse(token));
		if (!payload) throw new Error("This link is not valid.");
		const result = await applyTokenOptOut(emailDbFromEnv(), payload, z.boolean().parse(optedOut));
		if (!result) throw new Error("This link no longer applies to an email you can turn off.");
		return result;
	});
}

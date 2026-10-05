import { drizzle } from "drizzle-orm/d1";
import type { EmailDb } from "@/db/repositories/email-audience";
import * as schema from "@/db/schema";
import { getCloudflareEnv, getOptionalCloudflareEnv } from "@/server/cloudflare";
import { emailConfigFrom, type EmailConfig } from "./config";
import { bindingSender, type EmailSender } from "./sender";
import type { EmailJob } from "./jobs";

export function emailDbFromEnv(): EmailDb {
	return drizzle(getCloudflareEnv().DB, { schema });
}

export function emailConfigFromEnv(): EmailConfig {
	return emailConfigFrom((getOptionalCloudflareEnv() ?? process.env) as Record<string, unknown>);
}

export function sendingDepsFromEnv(): { sender: EmailSender; config: EmailConfig } {
	const env = getCloudflareEnv() as unknown as { EMAIL: Parameters<typeof bindingSender>[0] };
	return { sender: bindingSender(env.EMAIL), config: emailConfigFromEnv() };
}

export function emailQueueFromEnv(): Queue<EmailJob> {
	const queue = (getCloudflareEnv() as unknown as { EMAIL_JOBS?: Queue<EmailJob> }).EMAIL_JOBS;
	if (!queue) throw new Error("Email jobs are not configured. Please contact a portal admin.");
	return queue;
}

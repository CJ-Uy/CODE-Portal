import { drizzle } from "drizzle-orm/d1";
import type { EmailDb } from "@/db/repositories/email-audience";
import * as schema from "@/db/schema";
import { getCloudflareEnv } from "@/server/cloudflare";
import { emailConfigFrom, type EmailConfig } from "./config";
import { bindingSender, type EmailSender } from "./sender";

export function emailDbFromEnv(): EmailDb {
	return drizzle(getCloudflareEnv().DB, { schema });
}

export function emailConfigFromEnv(): EmailConfig {
	return emailConfigFrom(getCloudflareEnv() as unknown as Record<string, unknown>);
}

export function sendingDepsFromEnv(): { sender: EmailSender; config: EmailConfig } {
	const env = getCloudflareEnv() as unknown as { EMAIL: Parameters<typeof bindingSender>[0] };
	return { sender: bindingSender(env.EMAIL), config: emailConfigFromEnv() };
}

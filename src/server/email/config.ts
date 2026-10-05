import { z } from "zod";

export const SENDING_DOMAIN = "ateneocode.org";

const schema = z.object({
	EMAIL_INBOX_ADDRESS: z.string().email(),
	EMAIL_PUBLIC_BASE_URL: z.string().url(),
	EMAIL_UNSUBSCRIBE_SECRET: z.string().min(16),
	EMAIL_BATCH_PER_TICK: z.coerce.number().int().min(1).max(200).default(25),
	EMAIL_DAILY_CAP: z.coerce.number().int().min(1).default(300),
});

export type EmailConfig = {
	inboxAddress: string;
	publicBaseUrl: string;
	unsubscribeSecret: string;
	batchPerTick: number;
	dailyCap: number;
};

/** Reads the EMAIL_* vars from a Worker env (or any record). Throws when one is missing. */
export function emailConfigFrom(env: Record<string, unknown>): EmailConfig {
	const parsed = schema.parse(env);
	return {
		inboxAddress: parsed.EMAIL_INBOX_ADDRESS.toLowerCase(),
		publicBaseUrl: parsed.EMAIL_PUBLIC_BASE_URL.replace(/\/+$/, ""),
		unsubscribeSecret: parsed.EMAIL_UNSUBSCRIBE_SECRET,
		batchPerTick: parsed.EMAIL_BATCH_PER_TICK,
		dailyCap: parsed.EMAIL_DAILY_CAP,
	};
}

/** `inbox@x` + `tag` gives `inbox+tag@x`. Email Routing subaddressing delivers it to the `inbox@x` rule. */
export function plusAddress(inbox: string, tag: string): string {
	const [local, domain] = inbox.split("@");
	return `${local}+${tag}@${domain}`;
}

/** Reads the `+tag` back out of a recipient address, lowercased. */
export function plusTag(address: string): string | null {
	const match = /^[^+@\s]+\+([^@\s]+)@/.exec(address.trim().toLowerCase());
	return match ? match[1] : null;
}

export function isSendingAddress(address: string): boolean {
	return address.trim().toLowerCase().endsWith(`@${SENDING_DOMAIN}`);
}

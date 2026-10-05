export type OutgoingEmail = {
	to: string;
	from: { email: string; name: string };
	replyTo: string;
	subject: string;
	html: string;
	text: string;
	headers?: Record<string, string>;
};

export type EmailSender = { send(message: OutgoingEmail): Promise<{ messageId: string }> };

/** Account quota or rate limit. The dispatcher stops for this tick and keeps the attempt. */
export class EmailQuotaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EmailQuotaError";
	}
}

/** Wraps the Workers `send_email` binding. The binding throws an Error with a `code` property. */
export function bindingSender(binding: { send(message: unknown): Promise<{ messageId: string }> }): EmailSender {
	return {
		async send(message) {
			try {
				return await binding.send(message);
			} catch (error) {
				const code = String((error as { code?: unknown })?.code ?? "");
				const text = error instanceof Error ? error.message : String(error);
				if (/RATE|QUOTA|LIMIT/i.test(code) || /rate limit|quota|daily limit/i.test(text)) throw new EmailQuotaError(text);
				throw error instanceof Error ? error : new Error(text);
			}
		},
	};
}

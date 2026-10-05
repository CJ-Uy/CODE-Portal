// OpenNext generates .open-next/worker.js at build time; this entry wraps it to add the
// email jobs, cron, and the inbound email handler for beta and staged.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore generated at build time
import { default as handler } from "./.open-next/worker.js";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./src/db/schema";
import { emailConfigFrom } from "./src/server/email/config";
import { runEmailDispatch } from "./src/server/email/dispatch";
import { handleInboundEmail, MAX_INBOUND_BYTES } from "./src/server/email/inbound";
import { bindingSender } from "./src/server/email/sender";
import { runEmailJobs, type EmailJob } from "./src/server/email/jobs";

// Re-export the Durable Object classes OpenNext declares so a wrapper does not drop them.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore generated at build time
export { DOQueueHandler } from "./.open-next/worker.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore generated at build time
export { DOShardedTagCache } from "./.open-next/worker.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore generated at build time
export { BucketCachePurge } from "./.open-next/worker.js";

type Env = CloudflareEnv & { FEATURE_EMAIL?: string; EMAIL_JOBS: Queue<EmailJob> };

export default {
	fetch: handler.fetch,

	async queue(batch: MessageBatch<unknown>, env: Env) {
		if (env.FEATURE_EMAIL !== "true") throw new Error("Email delivery is disabled.");
		await runEmailJobs(batch, env.EMAIL_JOBS, drizzle(env.DB, { schema }), bindingSender(env.EMAIL), emailConfigFrom(env as unknown as Record<string, unknown>));
	},

	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		if (env.FEATURE_EMAIL !== "true") return;
		const db = drizzle(env.DB, { schema });
		ctx.waitUntil(
			runEmailDispatch(db, bindingSender(env.EMAIL), emailConfigFrom(env as unknown as Record<string, unknown>)).then(
				(result) => {
					if (result.claimed || result.sent || result.failed || result.paused) console.log("email dispatch", JSON.stringify(result));
				},
				(error) => console.error("email dispatch failed", error),
			),
		);
	},

	async email(message: ForwardableEmailMessage, env: Env) {
		if (env.FEATURE_EMAIL !== "true") {
			message.setReject("This address is not accepting mail.");
			return;
		}
		if (message.rawSize > MAX_INBOUND_BYTES) {
			message.setReject("Message is larger than 5 MB.");
			return;
		}
		const raw = await new Response(message.raw).arrayBuffer();
		await handleInboundEmail(drizzle(env.DB, { schema }), env.BUCKET, raw, { from: message.from, to: message.to });
	},
} satisfies ExportedHandler<Env>;

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
import { runFeedbackReminders } from "./src/server/feedback/reminders";
import { ensureEventAlbums, purgeExpiredGallery } from "./src/db/repositories/gallery";

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

type Env = CloudflareEnv & { FEATURE_EMAIL?: string; FEATURE_SURVEYS?: string; FEATURE_NOTIFICATIONS?: string; FEATURE_GALLERY?: string; EMAIL_JOBS: Queue<EmailJob> };

export default {
	fetch: handler.fetch,

	async queue(batch: MessageBatch<unknown>, env: Env) {
		if (env.FEATURE_EMAIL !== "true") throw new Error("Email delivery is disabled.");
		await runEmailJobs(batch, env.EMAIL_JOBS, drizzle(env.DB, { schema }), bindingSender(env.EMAIL), emailConfigFrom(env as unknown as Record<string, unknown>));
	},

	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		const db = drizzle(env.DB, { schema });
		let emailConfig: ReturnType<typeof emailConfigFrom> | null = null;
		if (env.FEATURE_EMAIL === "true") {
			try {
				emailConfig = emailConfigFrom(env as unknown as Record<string, unknown>);
			} catch (error) {
				// A bad EMAIL_* var stops email dispatch, but must not take the feedback reminders down with it.
				console.error("email config invalid", error);
			}
		}
		if (emailConfig) {
			ctx.waitUntil(
				runEmailDispatch(db, bindingSender(env.EMAIL), emailConfig).then(
					(result) => {
						if (result.claimed || result.sent || result.failed || result.paused) console.log("email dispatch", JSON.stringify(result));
					},
					(error) => console.error("email dispatch failed", error),
				),
			);
		}
		// Runs whether or not email is on. The flags come from the Worker env because notify() cannot read the OpenNext request config here.
		if (env.FEATURE_SURVEYS === "true") {
			ctx.waitUntil(
				runFeedbackReminders(db, {
					now: new Date(),
					notificationsEnabled: env.FEATURE_NOTIFICATIONS === "true",
					email: emailConfig ? { queue: env.EMAIL_JOBS, baseUrl: emailConfig.publicBaseUrl } : null,
				}).then(
					(result) => {
						if (result.surveys) console.log("feedback reminders", JSON.stringify(result));
					},
					(error) => console.error("feedback reminders failed", error),
				),
			);
		}
		// Every tick, but cheap: one indexed read each when nothing has started or expired.
		if (env.FEATURE_GALLERY === "true") {
			// Each event gets its album once it starts; the first run after release backfills every past event.
			ctx.waitUntil(
				ensureEventAlbums(db, new Date()).then(
					(made) => {
						if (made) console.log("gallery event albums", made);
					},
					(error) => console.error("gallery event albums failed", error),
				),
			);
			ctx.waitUntil(
				purgeExpiredGallery(db, async (item) => {
					// The original, its poster and any stored previews all live under the item's prefix.
					const prefix = `gallery/${item.id}/`;
					let cursor: string | undefined;
					do {
						const listed = await env.BUCKET.list({ prefix, cursor });
						if (listed.objects.length) await env.BUCKET.delete(listed.objects.map((object) => object.key));
						cursor = listed.truncated ? listed.cursor : undefined;
					} while (cursor);
				}).then(
					(result) => {
						if (result.items || result.folders) console.log("gallery purge", JSON.stringify(result));
					},
					(error) => console.error("gallery purge failed", error),
				),
			);
		}
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

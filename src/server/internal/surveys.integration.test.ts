import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { hashSharedToken } from "./shared-actor";
import { createSurveysInternalHandlers } from "./surveys";

const ADMIN_TOKEN = "admin-token";

async function seedAdminToken() {
	await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
		.bind("mem_admin", "admin@example.com", "Admin", "active")
		.run();
	await env.DB.prepare("INSERT INTO roles (id, key, label, description, kind) VALUES (?, ?, ?, ?, ?)")
		.bind("role_super", "super", "Super", "All", "admin")
		.run();
	await env.DB.prepare("INSERT INTO member_roles (member_id, role_id, assigned_at) VALUES (?, ?, ?)")
		.bind("mem_admin", "role_super", Date.now())
		.run();
	await env.DB.prepare("INSERT INTO shared_dev_tokens (token_hash, member_id, label) VALUES (?, ?, ?)")
		.bind(await hashSharedToken(ADMIN_TOKEN), "mem_admin", "Admin token")
		.run();
}

function handlers() {
	return createSurveysInternalHandlers({ db: drizzle(env.DB, { schema }), deployEnv: "dev", allowedOrigins: [] });
}

describe("internal surveys handlers", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM survey_answers").run();
		await env.DB.prepare("DELETE FROM survey_responses").run();
		await env.DB.prepare("DELETE FROM survey_assignments").run();
		await env.DB.prepare("DELETE FROM survey_questions").run();
		await env.DB.prepare("DELETE FROM surveys").run();
		await env.DB.prepare("DELETE FROM member_roles").run();
		await env.DB.prepare("DELETE FROM shared_dev_tokens").run();
		await env.DB.prepare("DELETE FROM roles").run();
		await env.DB.prepare("DELETE FROM members").run();
		await seedAdminToken();
	});

	it("returns 404 when DEPLOY_ENV is not dev", async () => {
		const prod = createSurveysInternalHandlers({ db: drizzle(env.DB, { schema }), deployEnv: "prod" });
		const response = await prod.fetch(
			new Request("https://dev.example.com/internal/surveys", { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }),
		);
		expect(response.status).toBe(404);
	});

	it("rejects an invalid bearer token with 401", async () => {
		const response = await handlers().fetch(
			new Request("https://dev.example.com/internal/surveys", { headers: { Authorization: "Bearer nope" } }),
		);
		expect(response.status).toBe(401);
	});

	it("lists surveys for an authorized admin token", async () => {
		const response = await handlers().fetch(
			new Request("https://dev.example.com/internal/surveys", { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }),
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ surveys: [] });
	});

	it("returns each question's required flag, help text and metric key", async () => {
		await env.DB.prepare("INSERT INTO surveys (id, title, status, created_by) VALUES (?, ?, ?, ?)").bind("srv_1", "Feedback", "draft", "mem_admin").run();
		await env.DB.prepare(
			"INSERT INTO survey_questions (id, survey_id, position, type, prompt, options_json, required, help, metric_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("srvq_1", "srv_1", 1, "scale", "Overall?", JSON.stringify(["Bad", "Good"]), 1, "Think of the whole day.", "overall")
			.run();

		const response = await handlers().fetch(
			new Request("https://dev.example.com/internal/surveys?op=get&id=srv_1", { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }),
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as { questions: unknown[] };
		expect(body.questions).toEqual([
			expect.objectContaining({ id: "srvq_1", required: true, help: "Think of the whole day.", metricKey: "overall" }),
		]);
	});

	it("denies create in shared dev with 403 even for an admin token", async () => {
		const response = await handlers().fetch(
			new Request("https://dev.example.com/internal/surveys", {
				method: "POST",
				headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" },
				body: JSON.stringify({ title: "X", questions: [{ type: "text", prompt: "Q" }] }),
			}),
		);
		expect(response.status).toBe(403);
	});
});

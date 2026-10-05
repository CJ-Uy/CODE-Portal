import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runAction } from "./action-result";

describe("runAction", () => {
	it("wraps a value", async () => {
		expect(await runAction(async () => 3)).toEqual({ ok: true, data: 3 });
	});
	it("returns the error message", async () => {
		expect(await runAction(async () => Promise.reject(new Error("Nope.")))).toEqual({ ok: false, error: "Nope." });
	});
	it("returns the first zod issue as plain text", async () => {
		const result = await runAction(async () => z.object({ name: z.string().min(1, "Add a name.") }).parse({ name: "" }));
		expect(result).toEqual({ ok: false, error: "Add a name." });
	});
});

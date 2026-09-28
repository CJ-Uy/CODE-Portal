import { describe, expect, it } from "vitest";
import { appEnvSchema, deployEnvSchema, resolveRuntimeEnvValue, storageModeSchema } from "./env";

describe("environment schemas", () => {
	it("accept the planned app and deploy axes", () => {
		expect(appEnvSchema.options).toEqual(["local", "shared", "production"]);
		expect(deployEnvSchema.options).toEqual(["dev", "prod"]);
		expect(storageModeSchema.options).toEqual(["local", "api", "r2-s3", "binding"]);
	});

	it("does not fall back to build-time values when Cloudflare runtime env exists", () => {
		expect(resolveRuntimeEnvValue("SHARED_API_TOKEN", {}, { SHARED_API_TOKEN: "embedded-secret" })).toBeUndefined();
		expect(resolveRuntimeEnvValue("SHARED_API_TOKEN", null, { SHARED_API_TOKEN: "local-secret" })).toBe("local-secret");
	});
});

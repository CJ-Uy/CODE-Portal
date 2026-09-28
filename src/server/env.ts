import { z } from "zod";
import { getOptionalCloudflareEnv } from "./cloudflare";

export const appEnvSchema = z.enum(["local", "shared", "production"]);
export const deployEnvSchema = z.enum(["dev", "prod"]);
export const storageModeSchema = z.enum(["local", "api", "r2-s3", "binding"]);

/**
 * Fail closed. Only the literal string "true" enables a surface, so a missing var, a typo,
 * a half-applied deploy, or a boolean that survived a JSON round trip as "True" all leave
 * the feature off. Exposing an unfinished page is the expensive mistake; hiding a finished
 * one is a one-line fix.
 */
export const featureFlagSchema = z
	.string()
	.optional()
	.transform((value) => value === "true");

const rawEnvSchema = z.object({
	APP_ENV: appEnvSchema.default("local"),
	DEPLOY_ENV: deployEnvSchema.optional(),
	STORAGE_MODE: storageModeSchema.default("local"),
	ALLOW_PRODUCTION_STORAGE_MODE_OVERRIDE: z.string().optional(),
	AUTH_SECRET: z.string().optional(),
	AUTH_GOOGLE_ID: z.string().optional(),
	AUTH_GOOGLE_SECRET: z.string().optional(),
	AUTH_URL: z.string().optional(),
	APP_BASE_URL: z.string().optional(),
	AUTH_ALLOWED_DOMAINS: z.string().optional(),
	AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL: z.string().optional(),
	SHARED_API_BASE_URL: z.string().optional(),
	SHARED_API_TOKEN: z.string().optional(),
	SHARED_API_ALLOWED_ORIGINS: z.string().optional(),
	R2_ACCOUNT_ID: z.string().optional(),
	R2_BUCKET_NAME: z.string().optional(),
	R2_ACCESS_KEY_ID: z.string().optional(),
	R2_SECRET_ACCESS_KEY: z.string().optional(),
	R2_ENDPOINT: z.string().optional(),
	LOCAL_SQLITE_PATH: z.string().default("./.local/dev.db"),
	LOCAL_STORAGE_DIR: z.string().default("./.local/uploads"),
	FEATURE_RETENTION: featureFlagSchema,
	FEATURE_LIBRARY: featureFlagSchema,
	FEATURE_ANNOUNCEMENTS: featureFlagSchema,
	FEATURE_NOTIFICATIONS: featureFlagSchema,
	FEATURE_SURVEYS: featureFlagSchema,
	FEATURE_LEADERBOARD: featureFlagSchema,
	FEATURE_PUBLIC_SITE: featureFlagSchema,
});

export type AppConfig = z.infer<typeof rawEnvSchema>;
export type AppEnv = AppConfig["APP_ENV"];
export type DeployEnv = NonNullable<AppConfig["DEPLOY_ENV"]>;
export type StorageMode = AppConfig["STORAGE_MODE"];

export function resolveRuntimeEnvValue(
	key: keyof AppConfig,
	cloudflareEnv: Partial<Record<keyof AppConfig, string>> | null,
	processEnv: Partial<Record<keyof AppConfig, string | undefined>>,
): string | undefined {
	return cloudflareEnv ? cloudflareEnv[key] : processEnv[key];
}

function runtimeEnvValue(key: keyof AppConfig): string | undefined {
	const cloudflareEnv = getOptionalCloudflareEnv() as Partial<Record<keyof AppConfig, string>> | null;
	return resolveRuntimeEnvValue(key, cloudflareEnv, process.env);
}

export function getAppConfig(): AppConfig {
	const parsed = rawEnvSchema.parse({
		APP_ENV: runtimeEnvValue("APP_ENV"),
		DEPLOY_ENV: runtimeEnvValue("DEPLOY_ENV"),
		STORAGE_MODE: runtimeEnvValue("STORAGE_MODE"),
		ALLOW_PRODUCTION_STORAGE_MODE_OVERRIDE: runtimeEnvValue("ALLOW_PRODUCTION_STORAGE_MODE_OVERRIDE"),
		AUTH_SECRET: runtimeEnvValue("AUTH_SECRET"),
		AUTH_GOOGLE_ID: runtimeEnvValue("AUTH_GOOGLE_ID"),
		AUTH_GOOGLE_SECRET: runtimeEnvValue("AUTH_GOOGLE_SECRET"),
		AUTH_URL: runtimeEnvValue("AUTH_URL"),
		APP_BASE_URL: runtimeEnvValue("APP_BASE_URL"),
		AUTH_ALLOWED_DOMAINS: runtimeEnvValue("AUTH_ALLOWED_DOMAINS"),
		AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL: runtimeEnvValue("AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL"),
		SHARED_API_BASE_URL: runtimeEnvValue("SHARED_API_BASE_URL"),
		SHARED_API_TOKEN: runtimeEnvValue("SHARED_API_TOKEN"),
		SHARED_API_ALLOWED_ORIGINS: runtimeEnvValue("SHARED_API_ALLOWED_ORIGINS"),
		R2_ACCOUNT_ID: runtimeEnvValue("R2_ACCOUNT_ID"),
		R2_BUCKET_NAME: runtimeEnvValue("R2_BUCKET_NAME"),
		R2_ACCESS_KEY_ID: runtimeEnvValue("R2_ACCESS_KEY_ID"),
		R2_SECRET_ACCESS_KEY: runtimeEnvValue("R2_SECRET_ACCESS_KEY"),
		R2_ENDPOINT: runtimeEnvValue("R2_ENDPOINT"),
		LOCAL_SQLITE_PATH: runtimeEnvValue("LOCAL_SQLITE_PATH"),
		LOCAL_STORAGE_DIR: runtimeEnvValue("LOCAL_STORAGE_DIR"),
		FEATURE_RETENTION: runtimeEnvValue("FEATURE_RETENTION"),
		FEATURE_LIBRARY: runtimeEnvValue("FEATURE_LIBRARY"),
		FEATURE_ANNOUNCEMENTS: runtimeEnvValue("FEATURE_ANNOUNCEMENTS"),
		FEATURE_NOTIFICATIONS: runtimeEnvValue("FEATURE_NOTIFICATIONS"),
		FEATURE_SURVEYS: runtimeEnvValue("FEATURE_SURVEYS"),
		FEATURE_LEADERBOARD: runtimeEnvValue("FEATURE_LEADERBOARD"),
		FEATURE_PUBLIC_SITE: runtimeEnvValue("FEATURE_PUBLIC_SITE"),
	});

	const issues: string[] = [];

	if (parsed.APP_ENV === "shared") {
		if (!parsed.SHARED_API_BASE_URL) issues.push("SHARED_API_BASE_URL is required when APP_ENV=shared.");
		if (!parsed.SHARED_API_TOKEN) issues.push("SHARED_API_TOKEN is required when APP_ENV=shared.");
	}

	if (parsed.APP_ENV !== "shared") {
		if (!parsed.AUTH_SECRET) issues.push("AUTH_SECRET is required unless APP_ENV=shared.");
		if (!parsed.AUTH_GOOGLE_ID) issues.push("AUTH_GOOGLE_ID is required unless APP_ENV=shared.");
		if (!parsed.AUTH_GOOGLE_SECRET) issues.push("AUTH_GOOGLE_SECRET is required unless APP_ENV=shared.");
	}

	if (parsed.DEPLOY_ENV === "prod") {
		if (parsed.SHARED_API_TOKEN) issues.push("SHARED_API_TOKEN must not be configured when DEPLOY_ENV=prod.");
		if (parsed.SHARED_API_BASE_URL) issues.push("SHARED_API_BASE_URL must not be configured when DEPLOY_ENV=prod.");
		if (parsed.SHARED_API_ALLOWED_ORIGINS) issues.push("SHARED_API_ALLOWED_ORIGINS must not be configured when DEPLOY_ENV=prod.");
		if (parsed.STORAGE_MODE === "binding" || parsed.ALLOW_PRODUCTION_STORAGE_MODE_OVERRIDE === "true") {
			// Production binding mode is valid.
		} else {
			issues.push("Production storage must use binding unless ALLOW_PRODUCTION_STORAGE_MODE_OVERRIDE=true.");
		}
	}

	if (parsed.APP_ENV === "production" && !parsed.DEPLOY_ENV && getOptionalCloudflareEnv()) {
		issues.push("DEPLOY_ENV is required for deployed Workers.");
	}

	if (parsed.STORAGE_MODE === "r2-s3") {
		for (const key of ["R2_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"] as const) {
			if (!parsed[key]) issues.push(`${key} is required when STORAGE_MODE=r2-s3.`);
		}
	}

	if (issues.length > 0) {
		throw new Error(issues.join(" "));
	}

	return parsed;
}

export function getPublicEnvStatus() {
	const config = getAppConfig();

	return {
		APP_ENV: config.APP_ENV,
		DEPLOY_ENV: config.DEPLOY_ENV ?? null,
		STORAGE_MODE: config.STORAGE_MODE,
		requiredEnv: {
			AUTH_SECRET: Boolean(config.AUTH_SECRET),
			AUTH_GOOGLE_ID: Boolean(config.AUTH_GOOGLE_ID),
			AUTH_GOOGLE_SECRET: Boolean(config.AUTH_GOOGLE_SECRET),
			AUTH_ALLOWED_DOMAINS: Boolean(config.AUTH_ALLOWED_DOMAINS),
			AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL: Boolean(config.AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL),
			SHARED_API_BASE_URL: Boolean(config.SHARED_API_BASE_URL),
			SHARED_API_TOKEN: Boolean(config.SHARED_API_TOKEN),
			SHARED_API_ALLOWED_ORIGINS: Boolean(config.SHARED_API_ALLOWED_ORIGINS),
			R2_ACCOUNT_ID: Boolean(config.R2_ACCOUNT_ID),
			R2_BUCKET_NAME: Boolean(config.R2_BUCKET_NAME),
			R2_ACCESS_KEY_ID: Boolean(config.R2_ACCESS_KEY_ID),
			R2_SECRET_ACCESS_KEY: Boolean(config.R2_SECRET_ACCESS_KEY),
			R2_ENDPOINT: Boolean(config.R2_ENDPOINT),
			LOCAL_SQLITE_PATH: Boolean(config.LOCAL_SQLITE_PATH),
			LOCAL_STORAGE_DIR: Boolean(config.LOCAL_STORAGE_DIR),
		},
	};
}

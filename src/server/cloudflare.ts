import { getCloudflareContext } from "@opennextjs/cloudflare";

export type CloudflareRuntimeEnv = CloudflareEnv & {
	APP_ENV?: string;
	DEPLOY_ENV?: string;
	STORAGE_MODE?: string;
	ALLOW_PRODUCTION_STORAGE_MODE_OVERRIDE?: string;
	AUTH_SECRET?: string;
	AUTH_GOOGLE_ID?: string;
	AUTH_GOOGLE_SECRET?: string;
	AUTH_URL?: string;
	APP_BASE_URL?: string;
	AUTH_ALLOWED_DOMAINS?: string;
	AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL?: string;
	SHARED_API_BASE_URL?: string;
	SHARED_API_TOKEN?: string;
	SHARED_API_ALLOWED_ORIGINS?: string;
};

export function getCloudflareEnv(): CloudflareRuntimeEnv {
	const { env } = getCloudflareContext();
	return env as CloudflareRuntimeEnv;
}

export function getOptionalCloudflareEnv(): CloudflareRuntimeEnv | null {
	try {
		return getCloudflareEnv();
	} catch {
		return null;
	}
}

export function hasCloudflareBinding(name: "DB" | "BUCKET"): boolean {
	const env = getOptionalCloudflareEnv();
	return Boolean(env?.[name]);
}

export function runInBackground(task: Promise<unknown>): void {
	const context = getOptionalCloudflareEnv() ? getCloudflareContext() : null;
	context?.ctx.waitUntil(task);
}

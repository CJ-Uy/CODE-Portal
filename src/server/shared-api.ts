import { getAppConfig } from "@/server/env";

export async function proxySharedApiRequest(request: Request, path: string): Promise<Response> {
	const config = getAppConfig();
	if (!config.SHARED_API_BASE_URL || !config.SHARED_API_TOKEN) {
		throw new Error("Shared API configuration is missing.");
	}

	const headers = new Headers(request.headers);
	headers.set("Authorization", `Bearer ${config.SHARED_API_TOKEN}`);
	headers.delete("cookie");
	headers.delete("host");

	const target = new URL(path, config.SHARED_API_BASE_URL);
	const explicitParams = new Set(target.searchParams.keys());
	for (const [name, value] of new URL(request.url).searchParams) {
		if (!explicitParams.has(name)) target.searchParams.append(name, value);
	}

	return fetch(target, {
		method: request.method,
		headers,
		body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
		redirect: "manual",
	});
}

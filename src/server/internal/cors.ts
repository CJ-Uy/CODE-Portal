export function getInternalCorsHeaders(request: Request, allowedOrigins: string[]): Headers | null {
	const origin = request.headers.get("origin");
	if (!origin) return new Headers();
	if (!allowedOrigins.includes(origin)) return null;

	return new Headers({
		"Access-Control-Allow-Headers": "Authorization, Content-Type",
		"Access-Control-Allow-Methods": "DELETE, GET, PATCH, POST, OPTIONS",
		"Access-Control-Allow-Origin": origin,
		Vary: "Origin",
	});
}

export function splitAllowedOrigins(value?: string): string[] {
	return value
		?.split(",")
		.map((item) => item.trim())
		.filter(Boolean) ?? [];
}

export function linkModerationPageUrl(offset: number, limit = 50): string {
	return `/api/links?scope=all&limit=${limit}&offset=${offset}`;
}

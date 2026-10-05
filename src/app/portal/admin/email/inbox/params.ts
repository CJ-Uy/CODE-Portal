type Params = { folder?: string | string[]; filter?: string | string[] };

export function parseInboxParams(params: Params) {
	const folder = params.folder === "done" ? "done" : "open";
	const filter = params.filter === "mine" || params.filter === "unassigned" ? params.filter : "all";
	return { folder, filter } as const;
}

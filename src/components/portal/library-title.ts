/**
 * The top-bar title for a library page. The portal shell's generic "Library item" fits only /portal/library/[id],
 * so every other library page is named here before that prefix match runs. Null means "not a library path".
 */
export function libraryPageTitle(pathname: string): string | null {
	const path = pathname.split("?")[0]!.replace(/\/+$/, "");
	if (path === "/portal/library") return "Library";
	if (!path.startsWith("/portal/library/")) return null;

	const [first, second, ...rest] = path.slice("/portal/library/".length).split("/");
	switch (first) {
		case "lists":
			return second === undefined || rest.length === 0 ? "Lists" : null;
		case "mine":
			return second === undefined ? "My items" : null;
		case "new":
			return second === undefined ? "Add to the library" : null;
		case "about":
			return second === undefined ? "About the library" : null;
		default:
			if (second === undefined) return "Library item";
			return second === "edit" && rest.length === 0 ? "Edit item" : null;
	}
}

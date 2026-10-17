import { GUIDE_AUDIENCES, type Guide, type GuideAudience } from "./content";

export type GuideAccess = {
	/** Holds survey:configure. */
	canAdmin: boolean;
	surveys: boolean;
	retention: boolean;
};

/** Admin guides need survey:configure and the surveys flag; any other guide needs the flags it lists in `requires`. */
export function visibleGuides(guides: Guide[], access: GuideAccess): Guide[] {
	return guides.filter(
		(guide) => (guide.audience !== "admin" || (access.canAdmin && access.surveys)) && (guide.requires ?? []).every((flag) => access[flag]),
	);
}

/** Narrows a `?for=` value to a known audience. Anything else means "all". */
export function parseAudience(value: unknown): GuideAudience | undefined {
	return GUIDE_AUDIENCES.find((audience) => audience === value);
}

export function filterByAudience(guides: Guide[], audience: GuideAudience | undefined): Guide[] {
	return audience ? guides.filter((guide) => guide.audience === audience) : guides;
}

// Splitting on anything that is not a letter or digit makes "check-in", "Check in" and "CHECK IN" the same query.
const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Every word of the query must start a word in the title, summary or a step title. An empty query keeps every guide. */
export function searchGuides(guides: Guide[], query: string): Guide[] {
	const terms = words(query);
	if (terms.length === 0) return guides;
	return guides.filter((guide) => {
		const haystack = words([guide.title, guide.summary, ...guide.steps.map((step) => step.title)].join(" "));
		return terms.every((term) => haystack.some((word) => word.startsWith(term)));
	});
}

/** The guides either side of `slug` in `list`, for prev/next links. Unknown slugs get neither. */
export function neighbours<T extends { slug: string }>(slug: string, list: T[]): { prev?: T; next?: T } {
	const index = list.findIndex((item) => item.slug === slug);
	if (index === -1) return {};
	return { prev: list[index - 1], next: list[index + 1] };
}

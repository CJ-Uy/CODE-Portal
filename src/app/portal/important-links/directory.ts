import { LINK_KIND_LABELS, type LinkKind } from "@/lib/link-kinds";

export type DirectoryLink = {
	id: string;
	title: string;
	url: string;
	description: string | null;
	kind: LinkKind;
	host: string;
	isNew: boolean;
};
export type DirectorySection = { id: string; name: string; links: DirectoryLink[] };

const NEW_FOR_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Links added in the last two weeks, but only once the directory has older links too.
 * When an admin fills the page for the first time, every link is new and the badge would mean nothing.
 */
export function newLinkIds(links: { id: string; createdAt: Date }[], now: Date): Set<string> {
	const isRecent = (createdAt: Date) => now.getTime() - createdAt.getTime() < NEW_FOR_MS;
	if (links.every((link) => isRecent(link.createdAt))) return new Set();
	return new Set(links.filter((link) => isRecent(link.createdAt)).map((link) => link.id));
}

/** Keeps the links whose category, title, description, type or site contain every word of the query. */
export function filterSections(sections: DirectorySection[], query: string): DirectorySection[] {
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return sections;
	return sections
		.map((section) => ({
			...section,
			links: section.links.filter((link) => {
				const text = `${section.name} ${link.title} ${link.description ?? ""} ${LINK_KIND_LABELS[link.kind]} ${link.host}`.toLowerCase();
				return words.every((word) => text.includes(word));
			}),
		}))
		.filter((section) => section.links.length > 0);
}

export function countLinks(sections: DirectorySection[]): number {
	return sections.reduce((total, section) => total + section.links.length, 0);
}

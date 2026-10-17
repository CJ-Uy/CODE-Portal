import type { LibraryCard } from "@/db/repositories/library";

/**
 * What a card shows and nothing more. This is the shape that may cross into a client component:
 * authors are names only (a card's authors also carry a member id), and none of the item's file or status fields come along.
 */
export type LibraryCardFields = Pick<LibraryCard, "id" | "kind" | "source" | "title" | "dek" | "year" | "publicReadiness" | "confidentiality" | "tagNames" | "saves"> & {
	authorsJson: { name: string }[];
};

export function toCardFields(card: LibraryCard): LibraryCardFields {
	return {
		id: card.id,
		kind: card.kind,
		source: card.source,
		title: card.title,
		dek: card.dek,
		year: card.year,
		publicReadiness: card.publicReadiness,
		confidentiality: card.confidentiality,
		tagNames: card.tagNames,
		saves: card.saves,
		authorsJson: card.authorsJson.map((author) => ({ name: author.name })),
	};
}

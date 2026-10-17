import { notFound, redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";
import { pickerTags } from "../../editor-input";
import { ItemEditor, type EditorItem } from "./item-editor";

export const dynamic = "force-dynamic";

// ponytail: the embed picker lists the 300 newest visible items. Past that, give the picker a server-side title search.
const PICKER_PAGES = [0, 100, 200];

export default async function EditLibraryItemPage({ params }: { params: Promise<{ id: string }> }) {
	if (!isFeatureEnabled("library")) notFound();
	const actor = await getActor();
	if (!actor) redirect("/signin");
	const { id } = await params;

	const repositories = await getRepositories();
	const item = await repositories.library.getItem(actor, id).catch(() => null);
	// Anyone who cannot edit the item gets the same 404 as a missing one.
	if (!item?.canEdit) notFound();

	const [tags, picked] = await Promise.all([
		repositories.libraryTags.listTags(),
		item.format === "page"
			? Promise.all(
					PICKER_PAGES.map((offset) =>
						repositories.library
							.search(actor, { sort: "newest", limit: 100, offset })
							.then((result) => result.cards)
							.catch(() => []),
					),
				)
			: Promise.resolve([]),
	]);

	const editorItem: EditorItem = {
		id: item.id,
		kind: item.kind,
		format: item.format,
		status: item.status,
		title: item.title,
		dek: item.dek,
		source: item.source,
		authors: item.authorsJson,
		subtype: item.subtype,
		formatDetail: item.formatDetail,
		engagementType: item.engagementType,
		year: item.year,
		url: item.url,
		blocks: item.blocksJson,
		tagIds: item.tags.map((tag) => tag.id),
		file: item.fileKey
			? { key: item.fileKey, name: item.fileName || item.fileKey.slice(item.fileKey.lastIndexOf("/") + 1), type: item.fileType ?? "", bytes: item.fileBytes ?? 0 }
			: null,
		moderationReason: item.moderationReason,
		containsClientData: item.containsClientData,
	};

	return (
		<ItemEditor
			item={editorItem}
			tags={pickerTags(tags, editorItem.tagIds).map(({ id: tagId, name, groupName }) => ({ id: tagId, name, groupName }))}
			itemPicker={picked.flat().filter((card) => card.id !== item.id).map((card) => ({ id: card.id, title: card.title }))}
			isOwner={item.createdBy === actor.memberId}
		/>
	);
}

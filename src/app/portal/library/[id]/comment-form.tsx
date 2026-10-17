"use client";

import { CommentBox } from "@/components/library/comment-box";
import { addCommentAction } from "../actions";

const COMMENT_MAX = 4000;

/** A comment on the item, or (with `parentId`) a reply to one of its top-level comments. A refused post shows its reason under the box. */
export function CommentForm({ itemId, parentId, label, placeholder }: { itemId: string; parentId?: string; label: string; placeholder: string }) {
	return (
		<CommentBox
			parentId={parentId}
			label={label}
			placeholder={placeholder}
			maxLength={COMMENT_MAX}
			post={async (draft) => {
				const data = new FormData();
				data.set("itemId", itemId);
				if (draft.parentId) data.set("parentId", draft.parentId);
				if (draft.anonymous) data.set("anonymous", "true");
				data.set("body", draft.body);
				await addCommentAction(data);
			}}
		/>
	);
}

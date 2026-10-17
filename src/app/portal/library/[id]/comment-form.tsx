"use client";

import { useState, useTransition } from "react";
import { CommentBox } from "@/components/library/comment-box";
import { Button } from "@/components/ui/button";
import { actionErrorMessage } from "../editor-input";
import { addCommentAction, setCommentHiddenAction } from "../actions";

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

/** Moderator Hide/Unhide for one comment. A refused change shows its reason under the button instead of crashing the page. */
export function HideCommentButton({ commentId, itemId, hidden }: { commentId: string; itemId: string; hidden: boolean }) {
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();
	return (
		<>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="h-7 px-2 text-xs"
				disabled={pending}
				onClick={() => {
					setError("");
					startTransition(async () => {
						try {
							const data = new FormData();
							data.set("commentId", commentId);
							data.set("itemId", itemId);
							data.set("hidden", hidden ? "false" : "true");
							await setCommentHiddenAction(data);
						} catch (e) {
							setError(actionErrorMessage(e, "Could not change that comment. Try again."));
						}
					});
				}}
			>
				{hidden ? "Unhide" : "Hide"}
			</Button>
			{error ? (
				<p role="alert" className="min-w-0 basis-full text-sm text-destructive [overflow-wrap:anywhere]">
					{error}
				</p>
			) : null}
		</>
	);
}

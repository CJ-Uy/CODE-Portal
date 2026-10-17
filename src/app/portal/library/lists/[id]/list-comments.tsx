"use client";

import { useState, useTransition } from "react";
import type { LibraryCommentView } from "@/db/repositories/library";
import { Button } from "@/components/ui/button";
import { CommentBox } from "@/components/library/comment-box";
import { cn } from "@/lib/utils";
import { actionErrorMessage } from "../../editor-input";
import { addListCommentAction, setListCommentHiddenAction } from "../../list-actions";
import { COMMENT_MAX } from "../../list-input";

const WHEN = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", day: "numeric", month: "short", year: "numeric" });

function CommentRow({ listId, comment, canModerate }: { listId: string; comment: LibraryCommentView; canModerate: boolean }) {
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();

	return (
		<div className={cn("min-w-0 rounded-xl border border-border p-3", comment.hidden && "opacity-60")}>
			<div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
				<div className="min-w-0 text-sm">
					<span className="min-w-0 font-medium [overflow-wrap:anywhere]">{comment.authorName}</span>
					{comment.anonymous && canModerate ? <span className="ml-2 text-xs text-muted-foreground">(anonymous)</span> : null}
					{comment.hidden ? <span className="ml-2 text-xs text-destructive">hidden</span> : null}
					<span className="ml-2 text-xs text-muted-foreground">{WHEN.format(comment.createdAt)}</span>
				</div>
				{canModerate ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-8 px-2 text-xs"
						disabled={pending}
						onClick={() => {
							setError("");
							startTransition(async () => {
								try {
									await setListCommentHiddenAction({ listId, commentId: comment.id, hidden: !comment.hidden });
								} catch (e) {
									setError(actionErrorMessage(e, "Could not change that comment. Try again."));
								}
							});
						}}
					>
						{comment.hidden ? "Unhide" : "Hide"}
					</Button>
				) : null}
			</div>
			<p className="mt-1 min-w-0 whitespace-pre-line text-sm text-foreground/90 [overflow-wrap:anywhere]">{comment.body}</p>
			{error ? (
				<p role="alert" className="mt-1 min-w-0 text-sm text-destructive [overflow-wrap:anywhere]">
					{error}
				</p>
			) : null}
		</div>
	);
}

function Reply({ listId, parentId }: { listId: string; parentId: string }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="ml-4 min-w-0 text-sm sm:ml-6">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="w-fit rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				Reply
			</button>
			{open ? (
				<div className="mt-2">
					<CommentBox
						post={(draft) => addListCommentAction({ listId, ...draft })}
						parentId={parentId}
						label="Reply"
						placeholder="Write a reply"
						maxLength={COMMENT_MAX}
						onPosted={() => setOpen(false)}
					/>
				</div>
			) : null}
		</div>
	);
}

/** The thread under a list. Anyone who can open the list reads it; `canComment` is false for a moderator looking at a list they cannot join. */
export function ListComments({ listId, comments, canComment, canModerate }: { listId: string; comments: LibraryCommentView[]; canComment: boolean; canModerate: boolean }) {
	const topLevel = comments.filter((comment) => !comment.parentId);
	const replies = new Map<string, LibraryCommentView[]>();
	for (const comment of comments) {
		if (comment.parentId) replies.set(comment.parentId, [...(replies.get(comment.parentId) ?? []), comment]);
	}

	return (
		<section aria-labelledby="list-discussion-title" className="grid min-w-0 gap-4">
			<h2 id="list-discussion-title" className="font-heading text-xl">
				Comments ({comments.filter((comment) => !comment.hidden).length})
			</h2>
			{canComment ? (
				<div className="rounded-xl border border-border p-4">
					<CommentBox post={(draft) => addListCommentAction({ listId, ...draft })} label="Comment" placeholder="Add a comment" maxLength={COMMENT_MAX} />
				</div>
			) : (
				<p className="min-w-0 text-sm text-muted-foreground">You can read this list as a moderator, but only people who can open it can comment.</p>
			)}
			<div className="grid gap-3">
				{topLevel.map((comment) => (
					<div key={comment.id} className="grid gap-2">
						<CommentRow listId={listId} comment={comment} canModerate={canModerate} />
						{(replies.get(comment.id) ?? []).map((reply) => (
							<div key={reply.id} className="ml-4 min-w-0 sm:ml-6">
								<CommentRow listId={listId} comment={reply} canModerate={canModerate} />
							</div>
						))}
						{canComment ? <Reply listId={listId} parentId={comment.id} /> : null}
					</div>
				))}
			</div>
		</section>
	);
}

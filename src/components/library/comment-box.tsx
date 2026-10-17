"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { actionErrorMessage } from "@/app/portal/library/editor-input";

export type CommentDraft = { parentId: string | null; anonymous: boolean; body: string };

/**
 * The one comment box for an item's discussion and a list's: anonymous posting is allowed, and a reply hangs under a top-level comment.
 * `post` is the server action. When it refuses (an empty comment, an item taken down in another tab) the reason shows under the box
 * instead of throwing into the page.
 */
export function CommentBox({
	post,
	parentId,
	label,
	placeholder,
	maxLength,
	onPosted,
}: {
	post: (draft: CommentDraft) => Promise<void>;
	parentId?: string;
	label: string;
	placeholder: string;
	maxLength: number;
	onPosted?: () => void;
}) {
	const [body, setBody] = useState("");
	const [anonymous, setAnonymous] = useState(false);
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();

	return (
		<form
			className="grid gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				const text = body.trim();
				if (!text) return;
				setError("");
				startTransition(async () => {
					try {
						await post({ parentId: parentId ?? null, anonymous, body: text });
						setBody("");
						setAnonymous(false);
						onPosted?.();
					} catch (e) {
						setError(actionErrorMessage(e, "Could not post that. Try again."));
					}
				});
			}}
		>
			<Textarea
				value={body}
				rows={parentId ? 2 : 3}
				placeholder={placeholder}
				aria-label={placeholder}
				maxLength={maxLength}
				required
				disabled={pending}
				onChange={(event) => setBody(event.target.value)}
			/>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<label className="flex items-center gap-2 text-sm text-muted-foreground">
					<Checkbox checked={anonymous} onCheckedChange={(value) => setAnonymous(value === true)} disabled={pending} />
					Post anonymously
				</label>
				<Button type="submit" size="sm" disabled={pending || !body.trim()}>
					{pending ? "Posting..." : label}
				</Button>
			</div>
			{error ? (
				<p role="alert" className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]">
					{error}
				</p>
			) : null}
		</form>
	);
}

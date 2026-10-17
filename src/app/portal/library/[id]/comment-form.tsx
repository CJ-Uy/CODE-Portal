"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { addCommentAction } from "../actions";

function Submit({ label }: { label: string }) {
	// Disabled while the comment is being posted, so a double tap cannot post it twice.
	const { pending } = useFormStatus();
	return (
		<Button type="submit" size="sm" disabled={pending}>
			{pending ? "Posting..." : label}
		</Button>
	);
}

/** A comment on the item, or (with `parentId`) a reply to one of its top-level comments. The form clears itself once posted. */
export function CommentForm({ itemId, parentId, label, placeholder }: { itemId: string; parentId?: string; label: string; placeholder: string }) {
	return (
		<form action={addCommentAction} className="grid gap-3">
			<input type="hidden" name="itemId" value={itemId} />
			{parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}
			<Textarea name="body" rows={parentId ? 2 : 3} placeholder={placeholder} aria-label={placeholder} maxLength={4000} required />
			<div className="flex flex-wrap items-center justify-between gap-3">
				<label className="flex items-center gap-2 text-sm text-muted-foreground">
					<Checkbox name="anonymous" />
					Post anonymously
				</label>
				<Submit label={label} />
			</div>
		</form>
	);
}

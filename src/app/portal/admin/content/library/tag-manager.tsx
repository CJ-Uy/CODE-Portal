"use client";

import { useId, useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/library/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { deleteTagAction, mergeTagsAction, regroupTagAction, renameTagAction } from "./actions";
import { TAG_NAME_MAX } from "./input";
import { deleteTagText, mergeTagText, usedByText } from "./rows";
import type { TagGroup, TagRow } from "./rows";
import { RowError, useRun } from "./use-run";

/** Every control is checked again on the server; the page only shows it to library moderators. */

const UNGROUPED = "Ungrouped";

type Ask = { kind: "delete"; tag: TagRow } | { kind: "merge"; from: TagRow; into: TagRow };

export function TagManager({ groups }: { groups: TagGroup[] }) {
	const { pending, error, run, clearError } = useRun();
	const [ask, setAsk] = useState<Ask | null>(null);
	const groupList = useId();
	const allTags = groups.flatMap((group) => group.tags);

	const close = () => {
		setAsk(null);
		clearError();
	};

	const confirm = () => {
		if (!ask) return;
		if (ask.kind === "delete") run(() => deleteTagAction({ tagId: ask.tag.id }), "Tag deleted.", close);
		else run(() => mergeTagsAction({ fromId: ask.from.id, intoId: ask.into.id }), "Tags merged.", close);
	};

	if (allTags.length === 0) {
		return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">There are no tags yet. Members create them from the editor.</p>;
	}

	return (
		<div className="grid min-w-0 gap-6">
			<datalist id={groupList}>
				{groups.map((group) => (
					<option key={group.groupName} value={group.groupName} />
				))}
			</datalist>

			{groups.map((group) => (
				<section key={group.groupName} aria-label={`${group.groupName} tags`} className="grid min-w-0 gap-2">
					<h2 className="min-w-0 break-all font-heading text-xl">{group.groupName}</h2>
					<ul className="grid min-w-0 gap-2">
						{group.tags.map((tag) => (
							// Keyed by what it shows, so a rename or a move that just landed resets the row's fields to the saved values.
							<TagItem key={`${tag.id}:${tag.name}:${tag.groupName}`} tag={tag} groups={groups} groupList={groupList} onAsk={setAsk} />
						))}
					</ul>
				</section>
			))}

			<Modal open={ask !== null} onOpenChange={(open) => !open && close()} locked={pending} labelledBy="tag-confirm-title">
				{ask ? (
					<div className="grid gap-4 p-5">
						<h2 id="tag-confirm-title" className="font-heading text-2xl">
							{ask.kind === "delete" ? "Delete this tag?" : "Merge these tags?"}
						</h2>
						<p className="min-w-0 text-sm [overflow-wrap:anywhere]">
							{ask.kind === "delete" ? deleteTagText(ask.tag.name, ask.tag.itemCount) : mergeTagText(ask.from.name, ask.into.name, ask.from.itemCount)}
						</p>
						<RowError message={error} />
						<div className="flex flex-wrap justify-end gap-2">
							<Button type="button" variant="outline" disabled={pending} onClick={close}>
								Cancel
							</Button>
							<Button
								type="button"
								className={ask.kind === "delete" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
								disabled={pending}
								onClick={confirm}
							>
								{pending ? "Working..." : ask.kind === "delete" ? "Delete tag" : "Merge tags"}
							</Button>
						</div>
					</div>
				) : null}
			</Modal>
		</div>
	);
}

function TagItem({ tag, groups, groupList, onAsk }: { tag: TagRow; groups: TagGroup[]; groupList: string; onAsk: (ask: Ask) => void }) {
	const { pending, error, run } = useRun();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState(tag.name);
	const [group, setGroup] = useState(tag.groupName);
	const [mergeInto, setMergeInto] = useState("");
	const panel = useId();
	const into = groups.flatMap((candidate) => candidate.tags).find((candidate) => candidate.id === mergeInto);

	return (
		<li className="min-w-0 rounded-lg border border-border bg-card">
			<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 p-3">
				<p className="min-w-0 flex-[1_1_8rem] break-all font-medium">{tag.name}</p>
				<span className="shrink-0 text-xs text-muted-foreground">{usedByText(tag.itemCount)}</span>
				<Button type="button" size="sm" variant="outline" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>
					{open ? "Close" : "Manage"}
				</Button>
			</div>

			{open ? (
				<div id={panel} className="grid min-w-0 gap-4 border-t border-border p-3 sm:grid-cols-2">
					<form
						className="grid min-w-0 gap-1"
						onSubmit={(event) => {
							event.preventDefault();
							run(() => renameTagAction({ tagId: tag.id, name }), "Tag renamed.");
						}}
					>
						<label className="grid gap-1 text-sm font-medium">
							Name
							<Input value={name} maxLength={TAG_NAME_MAX} disabled={pending} onChange={(event) => setName(event.target.value)} className="min-w-0 font-normal" />
						</label>
						<div>
							<Button type="submit" size="sm" variant="outline" disabled={pending || !name.trim() || name.trim() === tag.name}>
								Rename
							</Button>
						</div>
					</form>

					<form
						className="grid min-w-0 gap-1"
						onSubmit={(event) => {
							event.preventDefault();
							run(() => regroupTagAction({ tagId: tag.id, groupName: group }), "Tag moved.");
						}}
					>
						<label className="grid gap-1 text-sm font-medium">
							Group
							<Input
								value={group}
								list={groupList}
								maxLength={TAG_NAME_MAX}
								placeholder={UNGROUPED}
								disabled={pending}
								onChange={(event) => setGroup(event.target.value)}
								className="min-w-0 font-normal"
							/>
						</label>
						<div>
							<Button type="submit" size="sm" variant="outline" disabled={pending || (group.trim() || UNGROUPED) === tag.groupName}>
								Move
							</Button>
						</div>
					</form>

					<div className="grid min-w-0 gap-1">
						<label className="grid gap-1 text-sm font-medium">
							Merge into
							<Select value={mergeInto} disabled={pending} onChange={(event) => setMergeInto(event.target.value)} className="min-w-0 font-normal">
								<option value="">Choose a tag</option>
								{groups.map((candidate) => {
									const others = candidate.tags.filter((other) => other.id !== tag.id);
									return others.length === 0 ? null : (
										<optgroup key={candidate.groupName} label={candidate.groupName}>
											{others.map((other) => (
												<option key={other.id} value={other.id}>
													{other.name}
												</option>
											))}
										</optgroup>
									);
								})}
							</Select>
						</label>
						<div>
							<Button type="button" size="sm" variant="outline" disabled={pending || !into} onClick={() => into && onAsk({ kind: "merge", from: tag, into })}>
								Merge...
							</Button>
						</div>
					</div>

					<div className="grid content-end gap-1">
						<div>
							<Button
								type="button"
								size="sm"
								variant="outline"
								className="border-destructive/40 text-destructive"
								disabled={pending}
								onClick={() => onAsk({ kind: "delete", tag })}
							>
								<Trash2 aria-hidden />
								Delete tag...
							</Button>
						</div>
					</div>

					<div className="sm:col-span-2">
						<RowError message={error} />
					</div>
				</div>
			) : null}
		</li>
	);
}

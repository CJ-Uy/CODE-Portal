"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, ListPlus, Plus, Trash2 } from "lucide-react";
import type { GalleryItemView, GalleryList } from "@/db/repositories/gallery";
import { createGalleryListAction, deleteGalleryListAction, setGalleryListItemAction, setSavedAction } from "@/app/portal/gallery/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";

export function NewPhotoListForm({ onCreated }: { onCreated(list: GalleryList): Promise<void> | void }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	return (
		<form className="grid gap-3" onSubmit={async (event) => {
			event.preventDefault();
			const form = event.currentTarget;
			const name = String(new FormData(form).get("name") ?? "").trim();
			setBusy(true);
			setError("");
			try {
				const result = await createGalleryListAction({ name });
				if (!result.ok) return setError(result.error);
				await onCreated({ id: result.value, name });
				form.reset();
			} catch {
				setError("Could not create the list. Try again.");
			} finally {
				setBusy(false);
			}
		}}>
			<label className="grid gap-1.5 text-sm font-medium">
				List name
				<Input name="name" required maxLength={120} placeholder="e.g. Yearbook picks" disabled={busy} />
			</label>
			{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
			<Button type="submit" disabled={busy}><Plus />{busy ? "Creating…" : "Create list"}</Button>
		</form>
	);
}

export function SavePhotoForm({ item, initialLists, onUnsave }: { item: GalleryItemView; initialLists: GalleryList[]; onUnsave(): void }) {
	const [lists, setLists] = useState(initialLists);
	const [selected, setSelected] = useState(new Set(item.listIds));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	async function toggle(listId: string, on: boolean) {
		setBusy(true);
		setError("");
		try {
			const result = await setGalleryListItemAction({ itemId: item.id, listId, on });
			if (!result.ok) return setError(result.error);
			setSelected((current) => {
				const next = new Set(current);
				if (on) next.add(listId);
				else next.delete(listId);
				return next;
			});
		} catch {
			setError("Could not update your list. Try again.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<SheetHeader>
				<SheetTitle className="font-heading text-xl">Save to lists</SheetTitle>
				<SheetDescription>Saved in your personal library. Your lists are private.</SheetDescription>
			</SheetHeader>
			<div className="grid gap-5 px-4 pb-6">
				<div className="flex items-center gap-2 text-sm font-medium"><Bookmark className="size-4 fill-current" aria-hidden />Saved</div>
				{lists.length ? <ul className="grid gap-1" aria-label="Your lists">
					{lists.map((list) => <li key={list.id}>
						<label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-secondary">
							<Checkbox checked={selected.has(list.id)} disabled={busy} onCheckedChange={(on) => void toggle(list.id, on === true)} />
							<span className="min-w-0 break-words text-sm">{list.name}</span>
						</label>
					</li>)}
				</ul> : <p className="text-sm text-muted-foreground">Make a list to keep your picks together.</p>}
				{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
				<NewPhotoListForm onCreated={async (list) => {
					setLists((current) => [...current, list]);
					await toggle(list.id, true);
				}} />
				<Button variant="ghost" disabled={busy} onClick={async () => {
					setBusy(true);
					setError("");
					try {
						const result = await setSavedAction({ itemId: item.id, on: false });
						if (result.ok) onUnsave();
						else setError(result.error);
					} catch {
						setError("Could not remove the photo. Try again.");
					} finally {
						setBusy(false);
					}
				}}><Bookmark />Remove from Saved and all lists</Button>
			</div>
		</>
	);
}

export function SelectedPhotoListPicker({ count, initialLists, busy, error, onPick }: { count: number; initialLists: GalleryList[]; busy: boolean; error: string; onPick(listId: string): Promise<void> }) {
	const [lists, setLists] = useState(initialLists);
	return (
		<>
			<SheetHeader>
				<SheetTitle className="font-heading text-xl">Add {count} {count === 1 ? "photo" : "photos"} to a list</SheetTitle>
				<SheetDescription>These photos will also be saved to your personal library.</SheetDescription>
			</SheetHeader>
			<div className="grid gap-5 px-4 pb-6">
				{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
				{lists.length ? <ul className="grid gap-1" aria-label="Your lists">
					{lists.map((list) => <li key={list.id}>
						<Button variant="ghost" className="h-auto min-h-11 w-full justify-start whitespace-normal break-words text-left" disabled={busy} onClick={() => void onPick(list.id)}><ListPlus />{list.name}</Button>
					</li>)}
				</ul> : <p className="text-sm text-muted-foreground">Make a list for these photos.</p>}
				<NewPhotoListForm onCreated={async (list) => {
					setLists((current) => [...current, list]);
					await onPick(list.id);
				}} />
			</div>
		</>
	);
}

export function PhotoListControls({ list }: { list?: GalleryList }) {
	const router = useRouter();
	const toast = useToast();
	const [sheet, setSheet] = useState<"new" | "delete" | null>(null);
	const [busy, setBusy] = useState(false);
	return (
		<>
			<div className="flex flex-wrap gap-2">
				<Button variant="outline" onClick={() => setSheet("new")}><ListPlus />New list</Button>
				{list ? <Button variant="ghost" onClick={() => setSheet("delete")}><Trash2 />Delete list</Button> : null}
			</div>
			<Sheet open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
				<SheetContent className="w-full overflow-y-auto sm:max-w-md">
					<SheetHeader>
						<SheetTitle className="font-heading text-xl">{sheet === "delete" ? "Delete this list?" : "New photo list"}</SheetTitle>
						<SheetDescription>{sheet === "delete" ? "Your photos stay in Saved. Only this list is removed." : "Keep your photo picks together in a private list."}</SheetDescription>
					</SheetHeader>
					<div className="px-4 pb-6">
						{sheet === "new" ? <NewPhotoListForm onCreated={(created) => {
							setSheet(null);
							router.push(`/portal/gallery/saved?collection=${created.id}`);
						}} /> : list ? <Button className="bg-destructive text-white hover:bg-destructive/90" disabled={busy} onClick={async () => {
							setBusy(true);
							try {
								const result = await deleteGalleryListAction({ listId: list.id });
								if (!result.ok) return toast({ message: result.error });
								setSheet(null);
								router.push("/portal/gallery/saved");
							} catch {
								toast({ message: "Could not delete the list. Try again." });
							} finally {
								setBusy(false);
							}
						}}><Trash2 />Delete list</Button> : null}
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}

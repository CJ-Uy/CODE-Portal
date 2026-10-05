"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Lock, Plus, Save } from "lucide-react";
import type { EmailCategoryRow, EmailSenderRow } from "@/db/repositories/email-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
	moveCategoryAction,
	saveCategoryAction,
	saveSenderAction,
	setCategoryArchivedAction,
	setSenderArchivedAction,
} from "../actions";

type Editing =
	| { kind: "sender"; row: Partial<EmailSenderRow> }
	| { kind: "category"; row: Partial<EmailCategoryRow> }
	| null;

export function SettingsPanels({ senders, categories }: { senders: EmailSenderRow[]; categories: EmailCategoryRow[] }) {
	const router = useRouter();
	const toast = useToast();
	const [editing, setEditing] = useState<Editing>(null);
	const [showArchived, setShowArchived] = useState(false);
	const [pending, startTransition] = useTransition();
	const activeSenders = senders.filter((s) => !s.archivedAt);
	const visibleSenders = showArchived ? senders : activeSenders;
	const activeCategories = categories.filter((c) => !c.archivedAt);
	const visibleCategories = showArchived ? categories : activeCategories;

	const run = (task: () => Promise<{ ok: boolean; error?: string }>, success: string, undo?: () => void) =>
		startTransition(async () => {
			const result = await task();
			if (!result.ok) {
				toast({ message: result.error ?? "Something went wrong." });
				return;
			}
			toast({ message: success, action: undo ? { label: "Undo", onClick: undo } : undefined });
			setEditing(null);
			router.refresh();
		});

	return (
		<div className="grid gap-6">
			<label className="flex items-center gap-2 justify-self-end text-sm text-muted-foreground">
				<input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="size-4 accent-[#06192F]" />
				Show archived
			</label>

			<section className="grid gap-3 rounded-xl border border-border bg-card p-4">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<h2 className="font-heading text-xl">Senders</h2>
						<p className="text-sm text-muted-foreground">Use an @ateneocode.org address enabled for sending.</p>
					</div>
					<Button variant="outline" onClick={() => setEditing({ kind: "sender", row: {} })}>
						<Plus />
						Add sender
					</Button>
				</div>
				<ul className="grid divide-y divide-border">
					{visibleSenders.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No senders yet. Add one to start sending.</li> : null}
					{visibleSenders.map((s) => (
						<li key={s.id} className={cn("row-enter flex min-w-0 flex-wrap items-center gap-3 py-3", s.archivedAt && "opacity-60")}>
							<div className="grid min-w-0 flex-1 basis-full sm:basis-40">
								<span className="min-w-0 break-all font-medium">{s.displayName}</span>
								<span className="min-w-0 break-all text-sm text-muted-foreground">{s.address}</span>
							</div>
							<Button variant="ghost" size="sm" aria-label={`Edit ${s.displayName}`} onClick={() => setEditing({ kind: "sender", row: s })}>
								Edit
							</Button>
							<Button
								variant="ghost"
								size="sm"
								aria-label={`${s.archivedAt ? "Restore" : "Archive"} ${s.displayName}`}
								disabled={pending}
								onClick={() =>
									run(
										() => setSenderArchivedAction(s.id, !s.archivedAt),
										s.archivedAt ? "Sender restored." : "Sender archived.",
										s.archivedAt ? undefined : () => run(() => setSenderArchivedAction(s.id, false), "Sender restored."),
									)
								}
							>
								{s.archivedAt ? "Restore" : "Archive"}
							</Button>
						</li>
					))}
				</ul>
			</section>

			<section className="grid gap-3 rounded-xl border border-border bg-card p-4">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<h2 className="font-heading text-xl">Categories</h2>
						<p className="text-sm text-muted-foreground">Members see these, in this order, on their email preferences page.</p>
					</div>
					<Button variant="outline" onClick={() => setEditing({ kind: "category", row: { required: false } })}>
						<Plus />
						Add category
					</Button>
				</div>
				<ul className="grid divide-y divide-border">
					{visibleCategories.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No categories yet. Every email needs one.</li> : null}
					{visibleCategories.map((c) => {
						const index = activeCategories.findIndex((a) => a.id === c.id);
						return (
						<li key={c.id} className={cn("row-enter flex min-w-0 flex-wrap items-center gap-3 py-3", c.archivedAt && "opacity-60")}>
							<div className="grid min-w-0 flex-1 basis-full gap-0.5 sm:basis-40">
								<span className="flex min-w-0 items-center gap-2 font-medium">
									<span className="min-w-0 break-all">{c.name}</span>
									{c.required ? (
										<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
											<Lock className="size-3" aria-hidden />
											Required
										</span>
									) : (
										<span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">Optional</span>
									)}
								</span>
								{c.description ? <span className="min-w-0 break-all text-sm text-muted-foreground">{c.description}</span> : null}
							</div>
							<div className="flex items-center gap-1">
								<Button variant="ghost" size="icon" aria-label={`Move ${c.name} up`} disabled={pending || !!c.archivedAt || index === 0} onClick={() => run(() => moveCategoryAction(c.id, "up"), "Order saved.")}>
									<ArrowUp />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									aria-label={`Move ${c.name} down`}
									disabled={pending || !!c.archivedAt || index === activeCategories.length - 1}
									onClick={() => run(() => moveCategoryAction(c.id, "down"), "Order saved.")}
								>
									<ArrowDown />
								</Button>
								<Button variant="ghost" size="sm" aria-label={`Edit ${c.name}`} onClick={() => setEditing({ kind: "category", row: c })}>
									Edit
								</Button>
								<Button
									variant="ghost"
									size="sm"
									aria-label={`${c.archivedAt ? "Restore" : "Archive"} ${c.name}`}
									disabled={pending}
									onClick={() =>
										run(
											() => setCategoryArchivedAction(c.id, !c.archivedAt),
											c.archivedAt ? "Category restored." : "Category archived.",
											c.archivedAt ? undefined : () => run(() => setCategoryArchivedAction(c.id, false), "Category restored."),
										)
									}
								>
									{c.archivedAt ? "Restore" : "Archive"}
								</Button>
							</div>
						</li>
						);
					})}
				</ul>
				<Link href="/portal/mail/preferences" className="justify-self-start text-sm text-accent underline-offset-2 hover:underline">
					Preview the member preferences page
				</Link>
			</section>

			<Sheet open={editing !== null} onOpenChange={(open) => (open ? null : setEditing(null))}>
				<SheetContent>
					{editing?.kind === "sender" ? (
						<form
							className="grid gap-4 p-4"
							onSubmit={(e) => {
								e.preventDefault();
								const data = new FormData(e.currentTarget);
								run(
									() =>
										saveSenderAction({
											id: editing.row.id,
											address: String(data.get("address") ?? ""),
											displayName: String(data.get("displayName") ?? ""),
										}),
									"Sender saved.",
								);
							}}
						>
							<SheetHeader className="p-0">
								<SheetTitle>{editing.row.id ? "Edit sender" : "Add sender"}</SheetTitle>
								<SheetDescription>Members see the display name in their inbox.</SheetDescription>
							</SheetHeader>
							<label className="grid gap-2 text-sm font-medium">
								Display name
								<Input name="displayName" defaultValue={editing.row.displayName ?? ""} placeholder="CODE Events" maxLength={80} required />
							</label>
							<label className="grid gap-2 text-sm font-medium">
								Address
								<Input name="address" type="email" defaultValue={editing.row.address ?? ""} placeholder="events@ateneocode.org" required />
							</label>
							<Button type="submit" disabled={pending}>
								<Save />Save sender
							</Button>
						</form>
					) : null}
					{editing?.kind === "category" ? (
						<form
							className="grid gap-4 p-4"
							onSubmit={(e) => {
								e.preventDefault();
								const data = new FormData(e.currentTarget);
								run(
									() =>
										saveCategoryAction({
											id: editing.row.id,
											name: String(data.get("name") ?? ""),
											description: String(data.get("description") ?? ""),
											required: data.get("required") === "required",
											defaultSenderId: String(data.get("defaultSenderId") ?? "") || null,
										}),
									"Category saved.",
								);
							}}
						>
							<SheetHeader className="p-0">
								<SheetTitle>{editing.row.id ? "Edit category" : "Add category"}</SheetTitle>
								<SheetDescription>Required categories reach every member. Optional ones can be turned off.</SheetDescription>
							</SheetHeader>
							<label className="grid gap-2 text-sm font-medium">
								Name
								<Input name="name" defaultValue={editing.row.name ?? ""} placeholder="Newsletter" maxLength={60} required />
							</label>
							<label className="grid gap-2 text-sm font-medium">
								What members get
								<Textarea name="description" defaultValue={editing.row.description ?? ""} rows={3} maxLength={200} placeholder="Monthly news and opportunities." />
							</label>
							<fieldset className="grid gap-2">
								<legend className="text-sm font-medium">Can members turn it off?</legend>
								{[
									{ value: "optional", label: "Optional", hint: "Members can turn it off." },
									{ value: "required", label: "Required", hint: "Announcements and memos. Always delivered." },
								].map((option) => (
									<label
										key={option.value}
										className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary/50"
									>
										<input
											type="radio"
											name="required"
											value={option.value}
											defaultChecked={(editing.row.required ? "required" : "optional") === option.value}
											className="mt-1 accent-[#06192F]"
										/>
										<span className="grid">
											<span className="font-medium">{option.label}</span>
											<span className="text-sm text-muted-foreground">{option.hint}</span>
										</span>
									</label>
								))}
							</fieldset>
							<label className="grid gap-2 text-sm font-medium">
								Default sender
								<select
									name="defaultSenderId"
									defaultValue={editing.row.defaultSenderId ?? ""}
									className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
								>
									<option value="">None</option>
									{activeSenders.map((s) => (
										<option key={s.id} value={s.id}>
											{s.displayName} ({s.address})
										</option>
									))}
								</select>
							</label>
							<Button type="submit" disabled={pending}>
								<Save />Save category
							</Button>
						</form>
					) : null}
				</SheetContent>
			</Sheet>
		</div>
	);
}

"use client";

import { createElement, useMemo, useState } from "react";
import { GripVertical, Plus, Save, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { navPinIconFor, navPinIconNames } from "@/components/portal/nav-pin-icons";
import { createNavPinAction, deleteNavPinAction, saveNavPinsAction } from "./actions";

type NavPin = {
	id: string;
	label: string;
	url: string;
	icon: string;
	position: number;
};

function move<T>(items: T[], from: number, to: number): T[] {
	const next = [...items];
	const [item] = next.splice(from, 1);
	if (item) next.splice(to, 0, item);
	return next;
}

function iconLabel(icon: string): string {
	return icon.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function IconPicker({
	name = "icon",
	defaultValue = "Link2",
	form,
}: {
	name?: string;
	defaultValue?: string;
	form?: string;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [value, setValue] = useState(navPinIconNames.includes(defaultValue as (typeof navPinIconNames)[number]) ? defaultValue : "Link2");
	const icons = useMemo(
		() => navPinIconNames.filter((icon) => iconLabel(icon).toLowerCase().includes(query.trim().toLowerCase())),
		[query],
	);

	return (
		<div className="relative">
			<input type="hidden" name={name} value={value} form={form} />
			<button
				type="button"
				onClick={() => setOpen((current) => !current)}
				className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-xs outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				{createElement(navPinIconFor(value), { className: "size-4 shrink-0" })}
				<span className="flex-1 truncate">{iconLabel(value)}</span>
			</button>
			{open ? (
				<div className="absolute z-20 mt-2 w-72 rounded-md border border-border bg-card p-3 shadow-lg">
					<label className="flex h-9 items-center gap-2 rounded-md border border-input px-2">
						<Search className="size-4 text-muted-foreground" />
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search icons"
							className="min-w-0 flex-1 bg-transparent text-sm outline-none"
						/>
					</label>
					<div className="mt-3 grid max-h-56 grid-cols-6 gap-1 overflow-y-auto">
						{icons.map((icon) => {
							const selected = icon === value;
							return (
								<button
									key={icon}
									type="button"
									title={iconLabel(icon)}
									aria-label={iconLabel(icon)}
									onClick={() => {
										setValue(icon);
										setOpen(false);
										setQuery("");
									}}
									className={
										selected
											? "grid size-9 place-items-center rounded-md bg-primary text-primary-foreground"
											: "grid size-9 place-items-center rounded-md text-foreground hover:bg-muted"
									}
								>
									{createElement(navPinIconFor(icon), { className: "size-4" })}
								</button>
							);
						})}
					</div>
				</div>
			) : null}
		</div>
	);
}

export function NavPinsManager({ pins }: { pins: NavPin[] }) {
	const [items, setItems] = useState(pins);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const saveFormId = "nav-pins-save-form";

	function dragOver(id: string) {
		if (!draggingId || draggingId === id) return;
		const from = items.findIndex((item) => item.id === draggingId);
		const to = items.findIndex((item) => item.id === id);
		if (from >= 0 && to >= 0) setItems((current) => move(current, from, to));
	}

	async function deletePin(id: string) {
		setDeletingId(id);
		try {
			await deleteNavPinAction(id);
			setItems((current) => current.filter((item) => item.id !== id));
		} finally {
			setDeletingId(null);
		}
	}

	return (
		<div className="grid gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Add a nav pin</CardTitle>
					<CardDescription>Pinned links every signed-in member sees in the sidebar and mobile menu.</CardDescription>
				</CardHeader>
				<CardContent>
					<form action={createNavPinAction} className="grid gap-3 sm:grid-cols-[1fr_2fr_18rem_auto]">
						<Input name="label" placeholder="Label" required />
						<Input name="url" type="url" placeholder="https://" required />
						<IconPicker />
						<input type="hidden" name="position" value={items.length} />
						<Button type="submit">
							<Plus className="size-4" />
							Add
						</Button>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Pinned links ({items.length})</CardTitle>
					<CardDescription>Drag links into order, edit details inline, then save changes.</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					<form id={saveFormId} action={saveNavPinsAction} />
					<div className="flex justify-end">
						<Button type="submit" form={saveFormId} variant="outline" disabled={items.length === 0}>
							<Save className="size-4" />
							Save changes
						</Button>
					</div>

					<ol className="grid gap-2">
						{items.map((pin, index) => (
							<li
								key={pin.id}
								onDragOver={(event) => {
									event.preventDefault();
									dragOver(pin.id);
								}}
								className="grid gap-3 rounded-md border border-border bg-background p-3 md:grid-cols-[auto_1fr_2fr_12rem_auto] md:items-center"
							>
								<input form={saveFormId} type="hidden" name="ids" value={pin.id} />
								<div
									draggable
									onDragStart={() => setDraggingId(pin.id)}
									onDragEnd={() => setDraggingId(null)}
									className="flex cursor-grab items-center gap-2 text-sm font-semibold text-muted-foreground active:cursor-grabbing"
									aria-label="Drag to reorder"
								>
									<GripVertical className="size-4" />
									{index + 1}
								</div>
								<Input form={saveFormId} name="labels" defaultValue={pin.label} aria-label="Label" required />
								<Input form={saveFormId} name="urls" type="url" defaultValue={pin.url} aria-label="URL" required />
								<IconPicker form={saveFormId} name="icons" defaultValue={pin.icon} />
								<Button type="button" variant="outline" title="Delete" disabled={deletingId === pin.id} onClick={() => void deletePin(pin.id)}>
									<Trash2 className="size-4" />
									Delete
								</Button>
							</li>
						))}
					</ol>
				</CardContent>
			</Card>
		</div>
	);
}

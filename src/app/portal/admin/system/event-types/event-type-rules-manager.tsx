"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { EventTypeRow } from "@/db/repositories/eventTypeRules";
import { cn } from "@/lib/utils";
import { colourClasses, eventTypeColours, type EventTypeColour } from "@/lib/event-type-colours";
import { saveEventTypesAction, upsertEventTypeAction } from "./actions";
import { creatorPermissionOptions, creatorPermissionValue } from "./event-type-creator-permissions";

const colourLabels: Record<EventTypeColour, string> = {
	primary: "Navy",
	accent: "Blue",
	emerald: "Green",
	amber: "Amber",
	rose: "Rose",
	slate: "Slate",
};

function move<T>(items: T[], from: number, to: number): T[] {
	const next = [...items];
	const [item] = next.splice(from, 1);
	if (item) next.splice(to, 0, item);
	return next;
}

function ColourPicker({
	defaultValue = eventTypeColours[0],
	name = "colour",
	form,
}: {
	defaultValue?: string;
	name?: string;
	form?: string;
}) {
	const initial = eventTypeColours.includes(defaultValue as EventTypeColour)
		? (defaultValue as EventTypeColour)
		: eventTypeColours[0];
	const [value, setValue] = useState<EventTypeColour>(initial);

	return (
		<fieldset className="grid gap-1.5">
			<legend className="text-sm font-medium">Color</legend>
			<input type="hidden" name={name} value={value} form={form} />
			<div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
				{eventTypeColours.map((colour) => {
					const selected = colour === value;
					return (
						<button
							key={colour}
							type="button"
							aria-pressed={selected}
							onClick={() => setValue(colour)}
							className={cn(
								"flex h-10 items-center justify-center gap-2 rounded-md border px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								selected ? "border-primary bg-secondary font-semibold" : "border-input bg-background hover:bg-muted",
							)}
						>
							<span className={cn("size-3 rounded-full ring-1 ring-black/10", colourClasses(colour).dot)} />
							{colourLabels[colour]}
						</button>
					);
				})}
			</div>
		</fieldset>
	);
}

function PermissionSelect({
	current,
	name = "requiredPermission",
	form,
}: {
	current: string;
	name?: string;
	form?: string;
}) {
	return (
		<Select name={name} form={form} defaultValue={creatorPermissionValue(current)}>
			{creatorPermissionOptions.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</Select>
	);
}

function AddEventType({ position }: { position: number }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Add event type</CardTitle>
				<CardDescription>Create a reusable type for the calendar and event forms.</CardDescription>
			</CardHeader>
			<CardContent>
				<form action={upsertEventTypeAction} className="grid gap-4">
					<div className="grid gap-4 sm:grid-cols-2">
						<label className="grid gap-1.5 text-sm">
							<span className="font-medium">Key</span>
							<Input name="type" required maxLength={32} pattern="[a-z0-9_]+" placeholder="case_competition" />
							<span className="text-xs text-muted-foreground">Lowercase letters, numbers, and underscores.</span>
						</label>
						<label className="grid gap-1.5 text-sm">
							<span className="font-medium">Label</span>
							<Input name="label" required maxLength={60} placeholder="Case Competition" />
						</label>
						<label className="grid gap-1.5 text-sm">
							<span className="font-medium">Who can create it</span>
							<PermissionSelect current="" />
						</label>
						<label className="flex h-10 items-center gap-2 self-end text-sm font-medium">
							<input type="checkbox" name="active" defaultChecked className="size-4 accent-primary" />
							Available for new events
						</label>
					</div>
					<ColourPicker />
					<input type="hidden" name="position" value={position} />
					<div>
						<Button type="submit">
							<Plus />
							Add event type
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

function EventTypeEditor({
	row,
	index,
	count,
	formId,
	dragging,
	onDragStart,
	onDragOver,
	onDragEnd,
	onMove,
}: {
	row: EventTypeRow;
	index: number;
	count: number;
	formId: string;
	dragging: boolean;
	onDragStart: () => void;
	onDragOver: () => void;
	onDragEnd: () => void;
	onMove: (to: number) => void;
}) {
	const current = row.requiredPermission ?? "";

	return (
		<li
			onDragOver={(event) => {
				event.preventDefault();
				onDragOver();
			}}
			onDrop={onDragEnd}
			className={cn(
				"grid gap-4 rounded-lg border border-border bg-background p-4 transition-colors",
				dragging && "border-ring bg-muted/50",
			)}
		>
			<input type="hidden" name="types" value={row.type} form={formId} />
			<div className="flex min-w-0 items-center gap-3">
				<button
					type="button"
					draggable
					onDragStart={onDragStart}
					onDragEnd={onDragEnd}
					onKeyDown={(event) => {
						if (event.key === "ArrowUp" && index > 0) {
							event.preventDefault();
							onMove(index - 1);
						}
						if (event.key === "ArrowDown" && index < count - 1) {
							event.preventDefault();
							onMove(index + 1);
						}
					}}
					className="flex cursor-grab items-center gap-1 text-muted-foreground active:cursor-grabbing"
					aria-label={`Drag ${row.label} to reorder`}
					title="Drag to reorder"
				>
					<GripVertical className="size-5" />
					<span className="w-5 text-center text-sm tabular-nums">{index + 1}</span>
				</button>
				<span className={cn("size-3 shrink-0 rounded-full ring-1 ring-black/10", colourClasses(row.colour).dot)} />
				<div className="min-w-0 flex-1">
					<p className="truncate font-semibold">{row.label}</p>
					<div className="mt-1 flex flex-wrap items-center gap-1.5">
						<Badge variant="secondary" className="max-w-full break-all">
							{row.type}
						</Badge>
						<Badge variant={row.active ? "success" : "outline"}>{row.active ? "Available" : "Inactive"}</Badge>
					</div>
				</div>
				<div className="flex shrink-0">
					<Button
						type="button"
						size="icon"
						variant="ghost"
						disabled={index === 0}
						onClick={() => onMove(index - 1)}
						aria-label={`Move ${row.label} up`}
						title="Move up"
					>
						<ArrowUp />
					</Button>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						disabled={index === count - 1}
						onClick={() => onMove(index + 1)}
						aria-label={`Move ${row.label} down`}
						title="Move down"
					>
						<ArrowDown />
					</Button>
				</div>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<label className="grid gap-1.5 text-sm">
					<span className="font-medium">Label</span>
					<Input name="labels" form={formId} required maxLength={60} defaultValue={row.label} />
				</label>
				<label className="grid gap-1.5 text-sm">
					<span className="font-medium">Who can create it</span>
					<PermissionSelect name="requiredPermissions" form={formId} current={current} />
				</label>
			</div>

			<ColourPicker name="colours" form={formId} defaultValue={row.colour} />

			<label className="flex items-center gap-2 text-sm font-medium">
				<input
					type="checkbox"
					name="activeTypes"
					value={row.type}
					form={formId}
					defaultChecked={row.active}
					className="size-4 accent-primary"
				/>
				Available for new events
			</label>
		</li>
	);
}

export function EventTypeRulesManager({ rows }: { rows: EventTypeRow[] }) {
	const [items, setItems] = useState(rows);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const saveFormId = "event-types-save-form";

	function moveTo(type: string, to: number) {
		const from = items.findIndex((item) => item.type === type);
		if (from >= 0 && to >= 0 && to < items.length) setItems((current) => move(current, from, to));
	}

	function dragOver(type: string) {
		if (!draggingId || draggingId === type) return;
		const to = items.findIndex((item) => item.type === type);
		moveTo(draggingId, to);
	}

	const nextPosition = Math.min(999, Math.max(-1, ...items.map((item) => item.position)) + 1);

	return (
		<div className="grid gap-6">
			<Card>
				<CardHeader>
					<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
						<div className="grid gap-1.5">
							<CardTitle>Event types</CardTitle>
							<CardDescription>Drag types into order, edit their rules, then save all changes once.</CardDescription>
						</div>
						<Button type="submit" form={saveFormId} disabled={items.length === 0}>
							<Save />
							Save changes
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					<form id={saveFormId} action={saveEventTypesAction} />
					{items.length === 0 ? (
						<p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
							No event types yet. Add the first one below.
						</p>
					) : (
						<ol className="grid gap-3">
							{items.map((row, index) => (
								<EventTypeEditor
									key={row.type}
									row={row}
									index={index}
									count={items.length}
									formId={saveFormId}
									dragging={draggingId === row.type}
									onDragStart={() => setDraggingId(row.type)}
									onDragOver={() => dragOver(row.type)}
									onDragEnd={() => setDraggingId(null)}
									onMove={(to) => moveTo(row.type, to)}
								/>
							))}
						</ol>
					)}
				</CardContent>
			</Card>

			<AddEventType position={nextPosition} />
		</div>
	);
}

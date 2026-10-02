"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ArrowDown, ArrowUp, CalendarDays, Copy, GripVertical, Heading, Image as ImageIcon, Minus, Monitor, MousePointerClick,
	MoveVertical, Redo2, Smartphone, Trash2, Type, Undo2,
} from "lucide-react";
import { newBlock, newEventBlock } from "@/lib/email/blocks";
import type { MergeValues } from "@/lib/email/merge";
import { pillResolver, renderBlockHtml, renderFooterHtml, renderHeaderHtml, valueResolver, type FooterInput } from "@/lib/email/render";
import type { EmailBlock, EmailBlockType } from "@/lib/email/types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TaggedField } from "./tagged-field";

export type EventOption = { id: string; title: string; when: string; place: string };
export type PreviewPerson = { label: string; values: MergeValues };

const PALETTE: { type: EmailBlockType; label: string; icon: typeof Type }[] = [
	{ type: "heading", label: "Heading", icon: Heading },
	{ type: "text", label: "Text", icon: Type },
	{ type: "button", label: "Button", icon: MousePointerClick },
	{ type: "image", label: "Image", icon: ImageIcon },
	{ type: "event", label: "Event", icon: CalendarDays },
	{ type: "divider", label: "Divider", icon: Minus },
	{ type: "spacer", label: "Spacer", icon: MoveVertical },
];

type Props = {
	blocks: EmailBlock[];
	onChange: (blocks: EmailBlock[]) => void;
	baseUrl: string;
	footer: FooterInput;
	people: PreviewPerson[];
	events: EventOption[];
	layout?: "wide" | "compact";
};

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void; label: string }) {
	return (
		<div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border bg-background p-0.5">
			{options.map((o) => (
				<button
					key={String(o.value)}
					type="button"
					role="radio"
					aria-checked={o.value === value}
					onClick={() => onChange(o.value)}
					className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm transition-colors aria-checked:bg-primary aria-checked:text-primary-foreground"
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

export function BlockEditor({ blocks, onChange, baseUrl, footer, people, events, layout = "wide" }: Props) {
	const [selectedId, setSelectedId] = useState<string | null>(blocks[0]?.id ?? null);
	const [width, setWidth] = useState<600 | 375>(600);
	const [person, setPerson] = useState(-1); // -1 shows fields as pills
	const [past, setPast] = useState<EmailBlock[][]>([]);
	const [future, setFuture] = useState<EmailBlock[][]>([]);
	const [dragId, setDragId] = useState<string | null>(null);
	const [drop, setDrop] = useState<{ index: number } | null>(null);
	const [eventPicker, setEventPicker] = useState(false);
	const lastCommit = useRef(0);
	const canvasRef = useRef<HTMLDivElement>(null);

	const resolve = person < 0 ? pillResolver : valueResolver(people[person].values);
	const header = useMemo(() => renderHeaderHtml(`${baseUrl}/code-logo-full-navy.png`), [baseUrl]);
	const footerHtml = useMemo(() => renderFooterHtml(footer), [footer]);
	const selected = blocks.find((b) => b.id === selectedId) ?? null;

	const commit = useCallback(
		(next: EmailBlock[], coalesce = false) => {
			const now = Date.now();
			if (!coalesce || now - lastCommit.current > 800) setPast((p) => [...p.slice(-49), blocks]);
			lastCommit.current = now;
			setFuture([]);
			onChange(next);
		},
		[blocks, onChange],
	);
	const undo = () => {
		const previous = past.at(-1);
		if (!previous) return;
		lastCommit.current = 0;
		setPast((p) => p.slice(0, -1));
		setFuture((f) => [blocks, ...f]);
		onChange(previous);
	};
	const redo = () => {
		const next = future[0];
		if (!next) return;
		lastCommit.current = 0;
		setFuture((f) => f.slice(1));
		setPast((p) => [...p, blocks]);
		onChange(next);
	};

	const insert = (block: EmailBlock) => {
		const at = selectedId ? blocks.findIndex((b) => b.id === selectedId) + 1 : blocks.length;
		commit([...blocks.slice(0, at), block, ...blocks.slice(at)]);
		setSelectedId(block.id);
		requestAnimationFrame(() => canvasRef.current?.querySelector(`[data-block-id="${block.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
	};
	const update = (id: string, props: object) => commit(blocks.map((b) => (b.id === id ? ({ ...b, props: { ...b.props, ...props } } as EmailBlock) : b)), true);
	const move = (id: string, delta: -1 | 1) => {
		const i = blocks.findIndex((b) => b.id === id);
		const j = i + delta;
		if (i < 0 || j < 0 || j >= blocks.length) return;
		const next = [...blocks];
		[next[i], next[j]] = [next[j], next[i]];
		commit(next);
		requestAnimationFrame(() => canvasRef.current?.querySelector<HTMLElement>(`[data-block-id="${id}"]`)?.focus());
	};
	const remove = (id: string) => {
		const i = blocks.findIndex((b) => b.id === id);
		commit(blocks.filter((b) => b.id !== id));
		setSelectedId(blocks[i + 1]?.id ?? blocks[i - 1]?.id ?? null);
	};
	const duplicate = (id: string) => {
		const source = blocks.find((b) => b.id === id);
		if (!source) return;
		const copy = { ...structuredClone(source), id: `blk_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}` };
		const i = blocks.findIndex((b) => b.id === id);
		commit([...blocks.slice(0, i + 1), copy, ...blocks.slice(i + 1)]);
		setSelectedId(copy.id);
	};
	const moveTo = (id: string, index: number) => {
		const from = blocks.findIndex((b) => b.id === id);
		if (from < 0) return;
		const next = blocks.filter((b) => b.id !== id);
		next.splice(index > from ? index - 1 : index, 0, blocks[from]);
		commit(next);
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			if (target.closest("input, textarea, select, [contenteditable]")) return;
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
				e.preventDefault();
				if (e.shiftKey) redo();
				else undo();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	const palette = (
		<div className={cn(layout === "wide" ? "grid content-start gap-1.5 md:grid-cols-1" : "flex gap-1.5 overflow-x-auto pb-1", "max-md:flex max-md:overflow-x-auto max-md:pb-1")}>
			{PALETTE.map(({ type, label, icon: Icon }) => (
				<button
					key={type}
					type="button"
					onClick={() => (type === "event" ? setEventPicker((o) => !o) : insert(newBlock(type as Exclude<EmailBlockType, "event">)))}
					className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-[transform,border-color] hover:border-accent active:scale-[0.97]"
				>
					<Icon className="size-4 text-muted-foreground" aria-hidden />
					{label}
				</button>
			))}
		</div>
	);

	const eventList = eventPicker ? (
		<div className="toast-enter grid max-h-64 gap-1 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
			{events.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No events yet.</p> : null}
			{events.map((event) => (
				<button
					key={event.id}
					type="button"
					onClick={() => {
						insert(newEventBlock({ eventId: event.id, title: event.title, when: event.when, place: event.place }));
						setEventPicker(false);
					}}
					className="grid rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary"
				>
					<span className="min-w-0 truncate font-medium">{event.title}</span>
					<span className="text-xs text-muted-foreground">{event.when}</span>
				</button>
			))}
		</div>
	) : null;

	const toolbar = (
		<div className="flex flex-wrap items-center justify-between gap-2">
			<div className="flex items-center gap-1">
				<button type="button" onClick={undo} disabled={past.length === 0} aria-label="Undo" className="rounded-md p-1.5 transition-colors hover:bg-secondary disabled:opacity-40">
					<Undo2 className="size-4" />
				</button>
				<button type="button" onClick={redo} disabled={future.length === 0} aria-label="Redo" className="rounded-md p-1.5 transition-colors hover:bg-secondary disabled:opacity-40">
					<Redo2 className="size-4" />
				</button>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<select
					aria-label="Preview as"
					value={person}
					onChange={(e) => setPerson(Number(e.target.value))}
					className="h-8 rounded-md border border-input bg-background px-2 text-sm"
				>
					<option value={-1}>Show fields</option>
					{people.map((p, i) => (
						<option key={p.label} value={i}>
							Preview as {p.label}
						</option>
					))}
				</select>
				<Segmented
					label="Preview width"
					value={width}
					onChange={setWidth}
					options={[
						{ value: 600, label: <><Monitor className="size-3.5" aria-hidden /> Desktop</> },
						{ value: 375, label: <><Smartphone className="size-3.5" aria-hidden /> Phone</> },
					]}
				/>
			</div>
		</div>
	);

	const canvas = (
		<div className="grid min-w-0 gap-3 [overflow-wrap:anywhere]">
			{toolbar}
			<div ref={canvasRef} className="rounded-xl bg-[#F5F5F6] p-3 sm:px-14 sm:py-6">
				<div className="mx-auto rounded-xl bg-white shadow-sm transition-[max-width] duration-300 ease-out motion-reduce:transition-none" style={{ maxWidth: width }}>
					<table role="presentation" width="100%" cellPadding={0} cellSpacing={0} inert>
						<tbody dangerouslySetInnerHTML={{ __html: header }} />
					</table>
					{blocks.length === 0 ? (
						<p className="px-8 py-10 text-center text-sm text-muted-foreground">Add a block from the list to start writing.</p>
					) : null}
					{blocks.map((block, index) => {
						const isSelected = block.id === selectedId;
						return (
							<div
								key={block.id}
								data-block-id={block.id}
								tabIndex={0}
								role="group"
								aria-roledescription="block"
								aria-label={`Block ${index + 1}: ${block.type}`}
								aria-current={isSelected ? "true" : undefined}
								onClick={() => setSelectedId(block.id)}
								onKeyDown={(e) => {
									if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
									e.preventDefault();
									setSelectedId(block.id);
								}}
								onDragOver={(e) => {
									if (!dragId) return;
									e.preventDefault();
									const rect = e.currentTarget.getBoundingClientRect();
									setDrop({ index: e.clientY < rect.top + rect.height / 2 ? index : index + 1 });
								}}
								onDrop={(e) => {
									e.preventDefault();
									if (dragId && drop) moveTo(dragId, drop.index);
									setDragId(null);
									setDrop(null);
								}}
								className={cn(
									"row-enter group relative cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#4986AC] transition-[transform,box-shadow,opacity] duration-150",
									isSelected ? "outline outline-2 -outline-offset-2 outline-[#4986AC]" : "hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-[#90B4CC]",
									dragId === block.id && "scale-[1.02] opacity-60 shadow-lg",
								)}
							>
								{drop?.index === index ? <div className="absolute inset-x-2 -top-px z-10 h-0.5 rounded bg-[#06192F]" aria-hidden /> : null}
								{drop?.index === index + 1 && index === blocks.length - 1 ? <div className="absolute inset-x-2 -bottom-px z-10 h-0.5 rounded bg-[#06192F]" aria-hidden /> : null}
								<button
									type="button"
									draggable
									onDragStart={(e) => {
										setDragId(block.id);
										e.dataTransfer.effectAllowed = "move";
									}}
									onDragEnd={() => {
										setDragId(null);
										setDrop(null);
									}}
									aria-label="Drag to reorder"
									className="absolute -left-10 top-2 hidden cursor-grab rounded p-1 text-muted-foreground hover:bg-secondary sm:group-hover:block"
								>
									<GripVertical className="size-4" />
								</button>
								<table role="presentation" width="100%" cellPadding={0} cellSpacing={0} inert>
									<tbody dangerouslySetInnerHTML={{ __html: renderBlockHtml(block, resolve, baseUrl) }} />
								</table>
								{isSelected ? (
									<div className="toast-enter absolute right-1 top-1 z-10 flex gap-0.5 rounded-lg border border-border bg-card p-0.5 shadow-md sm:-right-12 sm:flex-col">
										<button type="button" aria-label="Move up" onClick={(e) => { e.stopPropagation(); move(block.id, -1); }} className="rounded p-1 hover:bg-secondary">
											<ArrowUp className="size-4" />
										</button>
										<button type="button" aria-label="Move down" onClick={(e) => { e.stopPropagation(); move(block.id, 1); }} className="rounded p-1 hover:bg-secondary">
											<ArrowDown className="size-4" />
										</button>
										<button type="button" aria-label="Duplicate" onClick={(e) => { e.stopPropagation(); duplicate(block.id); }} className="rounded p-1 hover:bg-secondary">
											<Copy className="size-4" />
										</button>
										<button type="button" aria-label="Delete" onClick={(e) => { e.stopPropagation(); remove(block.id); }} className="rounded p-1 hover:bg-secondary">
											<Trash2 className="size-4" />
										</button>
									</div>
								) : null}
							</div>
						);
					})}
					<table role="presentation" width="100%" cellPadding={0} cellSpacing={0} inert>
						<tbody dangerouslySetInnerHTML={{ __html: footerHtml }} />
					</table>
				</div>
			</div>
		</div>
	);

	const inspector = (
		<div className="grid content-start gap-4 rounded-xl border border-border bg-card p-4">
			{!selected ? <p className="text-sm text-muted-foreground">Select a block to edit it.</p> : null}
			{selected?.type === "heading" ? (
				<>
					<TaggedField label="Heading" value={selected.props.text} maxLength={200} onChange={(text) => update(selected.id, { text })} />
					<Segmented label="Heading size" value={selected.props.level} onChange={(level) => update(selected.id, { level })} options={[{ value: 1, label: "Large" }, { value: 2, label: "Small" }]} />
				</>
			) : null}
			{selected?.type === "text" ? (
				<TaggedField
					label="Text"
					multiline
					rows={8}
					maxLength={5000}
					value={selected.props.text}
					onChange={(text) => update(selected.id, { text })}
					hint="**bold**, *italic*, [link text](https://...). A blank line starts a new paragraph."
				/>
			) : null}
			{selected?.type === "button" ? (
				<>
					<TaggedField label="Button label" value={selected.props.label} maxLength={80} onChange={(label) => update(selected.id, { label })} />
					<label className="grid gap-2 text-sm font-medium">
						Link
						<Input value={selected.props.href} onChange={(e) => update(selected.id, { href: e.target.value })} placeholder="https://" />
					</label>
				</>
			) : null}
			{selected?.type === "image" ? (
				<>
					<label className="grid gap-2 text-sm font-medium">
						Image URL
						<Input value={selected.props.src} onChange={(e) => update(selected.id, { src: e.target.value })} placeholder="https://" />
					</label>
					<label className="grid gap-2 text-sm font-medium">
						Description for screen readers
						<Input value={selected.props.alt} maxLength={200} onChange={(e) => update(selected.id, { alt: e.target.value })} />
					</label>
					<label className="grid gap-2 text-sm font-medium">
						Link (optional)
						<Input value={selected.props.href ?? ""} onChange={(e) => update(selected.id, { href: e.target.value || undefined })} placeholder="https://" />
					</label>
				</>
			) : null}
			{selected?.type === "spacer" ? (
				<Segmented label="Space" value={selected.props.size} onChange={(size) => update(selected.id, { size })} options={[{ value: "sm", label: "Small" }, { value: "md", label: "Medium" }, { value: "lg", label: "Large" }]} />
			) : null}
			{selected?.type === "divider" ? <p className="text-sm text-muted-foreground">A thin line between sections. No settings.</p> : null}
			{selected?.type === "event" ? (
				<label className="grid gap-2 text-sm font-medium">
					Event
					<select
						value={selected.props.eventId}
						onChange={(e) => {
							const event = events.find((ev) => ev.id === e.target.value);
							if (event) update(selected.id, { eventId: event.id, title: event.title, when: event.when, place: event.place, path: `/portal/calendar/${event.id}` });
						}}
						className="h-9 rounded-md border border-input bg-background px-3 text-sm"
					>
						{events.map((event) => (
							<option key={event.id} value={event.id}>
								{event.title} ({event.when})
							</option>
						))}
					</select>
					<span className="text-xs font-normal text-muted-foreground">Title, time, and place refresh when the email is scheduled.</span>
				</label>
			) : null}
		</div>
	);

	if (layout === "compact") {
		return (
			<div className="grid gap-3">
				{palette}
				{eventList}
				{canvas}
				{inspector}
			</div>
		);
	}
	return (
		<div className="grid grid-cols-1 gap-4 md:grid-cols-[180px_minmax(0,1fr)] xl:grid-cols-[180px_minmax(0,1fr)_300px]">
			<div className="grid min-w-0 content-start gap-2">
				{palette}
				{eventList}
			</div>
			{canvas}
			<div className="min-w-0 md:col-span-2 xl:col-span-1">{inspector}</div>
		</div>
	);
}

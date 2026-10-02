"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Users, X } from "lucide-react";
import type { AudienceOptions, AudiencePreview } from "@/db/repositories/email-campaigns";
import type { Audience, AudienceRule } from "@/lib/email/types";
import { cn } from "@/lib/utils";
import { previewAudienceAction, searchMembersAction } from "@/app/portal/admin/email/actions";

type Suggestion = { rule: AudienceRule; label: string; hint: string };
const keyOf = (rule: AudienceRule) => JSON.stringify(rule);
const DATE = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", month: "short", day: "numeric" });
const RELATION = { rsvp: "RSVP'd to", attended: "Attended", no_show: "RSVP'd but missed" } as const;

export function ruleLabel(rule: AudienceRule, options: AudienceOptions, memberLabels: Record<string, string>): string {
	switch (rule.kind) {
		case "roster":
			return rule.termId === "current" ? "Current member list" : "Member list";
		case "role":
			return `Role: ${options.roles.find((r) => r.key === rule.roleKey)?.label ?? rule.roleKey}`;
		case "batch":
			return `Batch ${rule.batch}`;
		case "status":
			return `Status: ${rule.status}`;
		case "event":
			return `${RELATION[rule.relation]} ${options.events.find((e) => e.id === rule.eventId)?.title ?? "an event"}`;
		case "member":
			return memberLabels[rule.memberId] ?? "A member";
	}
}

function baseSuggestions(options: AudienceOptions): Suggestion[] {
	return [
		{ rule: { kind: "roster", termId: "current" }, label: "Current member list", hint: options.currentTermName ?? "No active school year" },
		...options.roles.map((r) => ({ rule: { kind: "role", roleKey: r.key } as AudienceRule, label: `Role: ${r.label}`, hint: "Admin role" })),
		...options.batches.map((b) => ({ rule: { kind: "batch", batch: b } as AudienceRule, label: `Batch ${b}`, hint: "Batch" })),
		...(["active", "pending", "inactive"] as const).map((s) => ({ rule: { kind: "status", status: s } as AudienceRule, label: `Status: ${s}`, hint: "Member status" })),
		...options.events.flatMap((e) =>
			(["rsvp", "attended", "no_show"] as const).map((relation) => ({
				rule: { kind: "event", eventId: e.id, relation } as AudienceRule,
				label: `${RELATION[relation]} ${e.title}`,
				hint: DATE.format(e.startsAt),
			})),
		),
	];
}

function TokenField({
	label,
	rules,
	onChange,
	options,
	memberLabels,
	onLabel,
}: {
	label: string;
	rules: AudienceRule[];
	onChange: (rules: AudienceRule[]) => void;
	options: AudienceOptions;
	memberLabels: Record<string, string>;
	onLabel: (memberId: string, name: string) => void;
}) {
	const listId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const [people, setPeople] = useState<Suggestion[]>([]);
	const base = useMemo(() => baseSuggestions(options), [options]);
	const chosen = new Set(rules.map(keyOf));

	useEffect(() => {
		const q = query.trim();
		if (q.length < 2) return;
		const timer = window.setTimeout(async () => {
			const result = await searchMembersAction(q);
			if (result.ok) {
				setPeople(result.data.map((m) => ({ rule: { kind: "member", memberId: m.id }, label: m.name, hint: m.batch ? `${m.email} · ${m.batch}` : m.email })));
			}
		}, 250);
		return () => window.clearTimeout(timer);
	}, [query]);

	const q = query.trim().toLowerCase();
	const matches = (q ? [...base.filter((s) => s.label.toLowerCase().includes(q)), ...(q.length < 2 ? [] : people)] : base.slice(0, 12)).filter((s) => !chosen.has(keyOf(s.rule))).slice(0, 10);

	const add = (s: Suggestion) => {
		if (s.rule.kind === "member") onLabel(s.rule.memberId, s.label);
		onChange([...rules, s.rule]);
		setQuery("");
		setActive(0);
		inputRef.current?.focus();
	};

	return (
		<div className="relative grid gap-2">
			<span className="text-sm font-medium">{label}</span>
			<div
				className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring"
				onClick={() => inputRef.current?.focus()}
			>
				{rules.map((rule) => (
					<span key={keyOf(rule)} className="row-enter inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-sm text-secondary-foreground">
						<span className="min-w-0 break-all">{ruleLabel(rule, options, memberLabels)}</span>
						<button
							type="button"
							aria-label={`Remove ${ruleLabel(rule, options, memberLabels)}`}
							onClick={() => onChange(rules.filter((r) => keyOf(r) !== keyOf(rule)))}
							className="shrink-0 rounded-full p-0.5 hover:bg-background/60"
						>
							<X className="size-3.5" />
						</button>
					</span>
				))}
				<input
					ref={inputRef}
					role="combobox"
					aria-expanded={open}
					aria-controls={listId}
					aria-label={label}
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setOpen(true);
						setActive(0);
					}}
					onFocus={() => setOpen(true)}
					onBlur={() => window.setTimeout(() => setOpen(false), 120)}
					onKeyDown={(e) => {
						if (e.key === "ArrowDown") {
							e.preventDefault();
							setActive((i) => Math.min(i + 1, matches.length - 1));
						} else if (e.key === "ArrowUp") {
							e.preventDefault();
							setActive((i) => Math.max(i - 1, 0));
						} else if (e.key === "Enter" && matches[active]) {
							e.preventDefault();
							add(matches[active]);
						} else if (e.key === "Backspace" && !query && rules.length > 0) {
							onChange(rules.slice(0, -1));
						} else if (e.key === "Escape") {
							setOpen(false);
						}
					}}
					placeholder={rules.length ? "Add more" : "Search groups, events, or members"}
					className="min-w-40 flex-1 bg-transparent px-1 py-1 text-sm outline-none"
				/>
			</div>
			{open && matches.length > 0 ? (
				<ul id={listId} role="listbox" className="toast-enter absolute top-full z-20 mt-1 grid max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
					{matches.map((s, i) => (
						<li key={keyOf(s.rule)} role="option" aria-selected={i === active}>
							<button
								type="button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => add(s)}
								onMouseEnter={() => setActive(i)}
								className={cn("flex w-full min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm", i === active && "bg-secondary")}
							>
								<span className="min-w-0 truncate">{s.label}</span>
								<span className="shrink-0 text-xs text-muted-foreground">{s.hint}</span>
							</button>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

export function AudiencePicker({
	value,
	onChange,
	options,
	memberLabels: initialLabels,
	categoryId,
	categoryName,
	onPreview,
}: {
	value: Audience;
	onChange: (audience: Audience) => void;
	options: AudienceOptions;
	memberLabels: Record<string, string>;
	categoryId: string | null;
	categoryName: string | null;
	onPreview: (preview: AudiencePreview | null) => void;
}) {
	const [labels, setLabels] = useState(initialLabels);
	const [preview, setPreview] = useState<AudiencePreview | null>(null);
	const [settled, setSettled] = useState<{ audience: Audience; categoryId: string | null } | null>(null);
	const [showExclude, setShowExclude] = useState(value.exclude.length > 0);
	const [expanded, setExpanded] = useState<"recipients" | "optedOut" | null>(null);
	const empty = value.include.length === 0;
	// Loading until a preview for the current inputs lands; derived so the effect needs no setState before its timer.
	const loading = !empty && (settled?.audience !== value || settled.categoryId !== categoryId);
	const shownPreview = empty ? null : preview; // derived so clearing the audience needs no setState in the effect
	const onLabel = (memberId: string, name: string) => setLabels((l) => ({ ...l, [memberId]: name }));

	useEffect(() => {
		if (value.include.length === 0) {
			onPreview(null);
			return;
		}
		const timer = window.setTimeout(async () => {
			const result = await previewAudienceAction(value, categoryId);
			setSettled({ audience: value, categoryId });
			if (result.ok) {
				setPreview(result.data);
				onPreview(result.data);
			}
		}, 300);
		return () => window.clearTimeout(timer);
		// onPreview is a stable setter from the parent.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value, categoryId]);

	return (
		<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
			<div className="grid content-start gap-3">
				<TokenField label="Send to" rules={value.include} onChange={(include) => onChange({ ...value, include })} options={options} memberLabels={labels} onLabel={onLabel} />
				{value.include.filter((r) => r.kind !== "member").length > 1 ? (
					<div className="flex flex-wrap items-center gap-2 text-sm">
						<span className="text-muted-foreground">Members who match</span>
						{(["any", "all"] as const).map((match) => (
							<button
								key={match}
								type="button"
								aria-pressed={value.match === match}
								onClick={() => onChange({ ...value, match })}
								className="rounded-full border border-border px-3 py-1 transition-colors aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
							>
								{match === "any" ? "any group" : "every group"}
							</button>
						))}
						<span className="text-muted-foreground">Hand-picked members are always included.</span>
					</div>
				) : null}
				{showExclude ? (
					<TokenField label="Don't send to" rules={value.exclude} onChange={(exclude) => onChange({ ...value, exclude })} options={options} memberLabels={labels} onLabel={onLabel} />
				) : (
					<button type="button" onClick={() => setShowExclude(true)} className="justify-self-start text-sm text-accent underline-offset-2 hover:underline">
						Leave some people out
					</button>
				)}
			</div>

			<div className="grid content-start gap-2 rounded-xl border border-border bg-secondary/40 p-4" aria-live="polite">
				<div className="flex items-center gap-2 text-muted-foreground">
					<Users className="size-4" aria-hidden />
					<span className="text-sm">Will receive</span>
				</div>
				<p className={cn("font-heading text-4xl tabular-nums transition-opacity", loading && "opacity-40")}>
					{empty ? "0" : loading && !shownPreview ? "..." : (shownPreview?.willReceive ?? 0)}
				</p>
				{shownPreview ? (
					<div className="grid gap-1 text-sm text-muted-foreground">
						<span>of {shownPreview.matched} matched</span>
						{shownPreview.optedOut.length > 0 ? (
							<button type="button" className="flex items-center gap-1 text-left underline-offset-2 hover:underline" onClick={() => setExpanded(expanded === "optedOut" ? null : "optedOut")}>
								{shownPreview.optedOut.length} opted out of {categoryName ?? "this category"}
								<ChevronDown className={cn("size-3.5 transition-transform", expanded === "optedOut" && "rotate-180")} aria-hidden />
							</button>
						) : null}
						{shownPreview.willReceive > 0 ? (
							<button type="button" className="flex items-center gap-1 text-left underline-offset-2 hover:underline" onClick={() => setExpanded(expanded === "recipients" ? null : "recipients")}>
								See who
								<ChevronDown className={cn("size-3.5 transition-transform", expanded === "recipients" && "rotate-180")} aria-hidden />
							</button>
						) : null}
						{expanded ? (
							<ul className="row-enter mt-1 grid max-h-48 gap-0.5 overflow-y-auto text-foreground">
								{(expanded === "optedOut" ? shownPreview.optedOut : shownPreview.recipients).map((m) => (
									<li key={m.memberId} className="min-w-0 truncate">
										{m.name}
									</li>
								))}
								{expanded === "recipients" && shownPreview.willReceive > shownPreview.recipients.length ? (
									<li className="text-muted-foreground">and {shownPreview.willReceive - shownPreview.recipients.length} more</li>
								) : null}
							</ul>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}

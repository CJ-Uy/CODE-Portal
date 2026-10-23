"use client";

import { useId, useRef, useState } from "react";
import { Braces } from "lucide-react";
import { isMergeTag, MERGE_TAGS, mergeLabel } from "@/lib/email/merge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type SheetField = { header: string; variable: string };

type Props = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	multiline?: boolean;
	rows?: number;
	maxLength?: number;
	hint?: string;
	placeholder?: string;
	/** Sheet columns offered after the profile fields. */
	fields?: SheetField[];
	/** HTML source: monospace, no wrapping, and "{" types a brace instead of opening the menu. */
	code?: boolean;
	/** Extra controls beside Insert field. */
	actions?: React.ReactNode;
};

/** Text input that inserts {{tags}}. Type "{" or use the Insert field button. */
export function TaggedField({ label, value, onChange, multiline, rows = 5, maxLength, hint, placeholder, fields = [], code, actions }: Props) {
	const id = useId();
	const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
	const caret = useRef<{ start: number; end: number }>({ start: value.length, end: value.length });
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const viaBrace = useRef(false); // Escape only types the "{" back when the menu was opened by typing it
	const blurTimer = useRef<number | undefined>(undefined);
	const options: string[] = [...MERGE_TAGS, ...fields.map((f) => f.variable).filter((f) => !isMergeTag(f))];
	const labelOf = (tag: string) => fields.find((f) => f.variable === tag && !isMergeTag(tag))?.header ?? mergeLabel(tag);

	const remember = () => {
		const el = ref.current;
		caret.current = { start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
	};
	const insert = (text: string) => {
		const { start, end } = caret.current;
		onChange(value.slice(0, start) + text + value.slice(end));
		setOpen(false);
		requestAnimationFrame(() => {
			ref.current?.focus();
			ref.current?.setSelectionRange(start + text.length, start + text.length);
		});
	};
	const pick = (tag: string) => insert(`{{${tag}}}`);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (open) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
			} else if (e.key === "Enter") {
				e.preventDefault();
				pick(options[active]);
			} else if (e.key === "Escape") {
				e.preventDefault();
				if (viaBrace.current) insert("{");
				else setOpen(false);
			}
			return;
		}
		if (e.key === "{" && !code) {
			e.preventDefault();
			remember();
			viaBrace.current = true;
			setActive(0);
			setOpen(true);
		}
	};

	const onFocus = () => window.clearTimeout(blurTimer.current);
	const onBlur = () => {
		blurTimer.current = window.setTimeout(() => {
			if (open && viaBrace.current) {
				viaBrace.current = false;
				const { start, end } = caret.current;
				onChange(value.slice(0, start) + "{" + value.slice(end));
			}
			setOpen(false);
		}, 120);
	};

	const field = multiline || code ? (
		<Textarea
			id={id}
			ref={ref}
			rows={rows}
			value={value}
			maxLength={maxLength}
			placeholder={placeholder}
			spellCheck={code ? false : undefined}
			wrap={code ? "off" : undefined}
			className={cn(code && "font-mono text-xs leading-5 [tab-size:2]")}
			onChange={(e) => onChange(e.target.value)}
			onKeyDown={onKeyDown}
			onSelect={remember}
			onFocus={onFocus}
			onBlur={onBlur}
		/>
	) : (
		<Input id={id} ref={ref} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onSelect={remember} onFocus={onFocus} onBlur={onBlur} />
	);

	return (
		<div className="relative grid min-w-0 gap-2">
			<div className="flex items-center justify-between gap-2">
				<label htmlFor={id} className="text-sm font-medium">
					{label}
				</label>
				<span className="flex items-center gap-1">
					{actions}
					<button
						type="button"
						className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-accent transition-colors hover:bg-secondary"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => {
							remember();
							viaBrace.current = false;
							setActive(0);
							setOpen((o) => !o);
						}}
						aria-expanded={open}
					>
						<Braces className="size-3.5" aria-hidden />
						Insert field
					</button>
				</span>
			</div>
			{field}
			{open ? (
				<ul role="listbox" aria-label="Fields" className="toast-enter absolute right-0 top-8 z-20 grid max-h-72 w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
					{options.map((tag, i) => (
						<li key={tag} role="option" aria-selected={i === active} className="grid">
							{i === MERGE_TAGS.length ? <span className="px-2 pb-1 pt-2 text-xs text-muted-foreground">From your sheet</span> : null}
							<button
								type="button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => pick(tag)}
								className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm data-[active=true]:bg-secondary"
								data-active={i === active}
							>
								<span className="min-w-0 truncate">{labelOf(tag)}</span>
								<code className="shrink-0 text-xs text-muted-foreground">{`{{${tag}}}`}</code>
							</button>
						</li>
					))}
				</ul>
			) : null}
			{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
		</div>
	);
}

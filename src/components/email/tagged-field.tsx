"use client";

import { useId, useRef, useState } from "react";
import { Braces } from "lucide-react";
import { MERGE_TAGS, MERGE_TAG_LABELS, type MergeTag } from "@/lib/email/merge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Props = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	multiline?: boolean;
	rows?: number;
	maxLength?: number;
	hint?: string;
	placeholder?: string;
};

/** Text input that inserts {{tags}}. Type "{" or use the Insert field button. */
export function TaggedField({ label, value, onChange, multiline, rows = 5, maxLength, hint, placeholder }: Props) {
	const id = useId();
	const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
	const caret = useRef<{ start: number; end: number }>({ start: value.length, end: value.length });
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const viaBrace = useRef(false); // Escape only types the "{" back when the menu was opened by typing it
	const blurTimer = useRef<number | undefined>(undefined);

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
	const pick = (tag: MergeTag) => insert(`{{${tag}}}`);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (open) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + MERGE_TAGS.length) % MERGE_TAGS.length);
			} else if (e.key === "Enter") {
				e.preventDefault();
				pick(MERGE_TAGS[active]);
			} else if (e.key === "Escape") {
				e.preventDefault();
				if (viaBrace.current) insert("{");
				else setOpen(false);
			}
			return;
		}
		if (e.key === "{") {
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

	const field = multiline ? (
		<Textarea id={id} ref={ref} rows={rows} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onSelect={remember} onFocus={onFocus} onBlur={onBlur} />
	) : (
		<Input id={id} ref={ref} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onSelect={remember} onFocus={onFocus} onBlur={onBlur} />
	);

	return (
		<div className="relative grid gap-2">
			<div className="flex items-center justify-between gap-2">
				<label htmlFor={id} className="text-sm font-medium">
					{label}
				</label>
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
			</div>
			{field}
			{open ? (
				<ul role="listbox" aria-label="Fields" className="toast-enter absolute right-0 top-8 z-20 grid w-48 rounded-lg border border-border bg-popover p-1 shadow-lg">
					{MERGE_TAGS.map((tag, i) => (
						<li key={tag} role="option" aria-selected={i === active}>
							<button
								type="button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => pick(tag)}
								className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm data-[active=true]:bg-secondary"
								data-active={i === active}
							>
								{MERGE_TAG_LABELS[tag]}
								<code className="text-xs text-muted-foreground">{`{{${tag}}}`}</code>
							</button>
						</li>
					))}
				</ul>
			) : null}
			{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
		</div>
	);
}

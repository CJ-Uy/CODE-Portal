"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PersonalizationPreview } from "@/db/repositories/email-campaigns";
import { MERGE_TAG_LABELS, type MergeOverrides, type MergeTag } from "@/lib/email/merge";
import { renderEmail, valueResolver, type FooterInput } from "@/lib/email/render";
import type { Audience, EmailBlock } from "@/lib/email/types";
import { cn } from "@/lib/utils";
import { previewPersonalizationAction } from "./actions";

type Person = PersonalizationPreview["rows"][number];

export function Personalization({ audience, categoryId, tags, overrides, onChange, onPreview, subject, preheader, blocks, baseUrl, footer }: {
	audience: Audience; categoryId: string | null; tags: MergeTag[]; overrides: MergeOverrides; onChange: (value: MergeOverrides) => void;
	onPreview: (value: PersonalizationPreview) => void;
	subject: string; preheader: string; blocks: EmailBlock[]; baseUrl: string; footer: FooterInput;
}) {
	const [q, setQ] = useState("");
	const [missingOnly, setMissingOnly] = useState(false);
	const [page, setPage] = useState(0);
	const [result, setResult] = useState<PersonalizationPreview | null>(null);
	const [selected, setSelected] = useState<Person | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [retry, setRetry] = useState(0);

	useEffect(() => {
		let cancelled = false;
		const timeout = window.setTimeout(async () => {
			setLoading(true);
			setError("");
			try {
				const response = await previewPersonalizationAction({ audience, categoryId, tags, overrides, q, missingOnly, page });
				if (cancelled) return;
				if (!response.ok) return setError(response.error);
				setResult(response.data);
				onPreview(response.data);
				setSelected((old) => old ? response.data.rows.find((r) => r.email === old.email) ?? old : null);
			} catch { if (!cancelled) setError("Could not check recipients. Try again."); }
			finally { if (!cancelled) setLoading(false); }
		}, 250);
		return () => { cancelled = true; window.clearTimeout(timeout); };
	}, [audience, categoryId, tags, overrides, q, missingOnly, page, retry, onPreview]);

	const values = useMemo(() => selected ? { ...selected.sourceValues, ...overrides[selected.email.toLowerCase()] } : null, [selected, overrides]);
	const rendered = useMemo(() => values ? renderEmail({ subject, preheader, blocks, baseUrl, footer: selected?.external ? { ...footer, guest: true, archiveUrl: null, unsubscribeUrl: null } : footer, values, resolve: valueResolver(values) }) : null, [subject, preheader, blocks, baseUrl, footer, values, selected?.external]);
	const update = (tag: Exclude<MergeTag, "email">, value: string) => {
		if (!selected) return;
		const key = selected.email.toLowerCase();
		onChange({ ...overrides, [key]: { ...overrides[key], [tag]: value } });
	};
	const reset = () => {
		if (!selected) return;
		const next = { ...overrides };
		delete next[selected.email.toLowerCase()];
		onChange(next);
	};

	return (
		<div className="grid gap-4">
			<p className="text-sm text-muted-foreground">Check the actual values for your receiving audience. Corrections save with this draft and leave member profiles unchanged. <code>{"{{firstname}}"}</code> and <code>{"{{first_name}}"}</code> both work.</p>
			<div className="flex flex-wrap items-center gap-3">
				<div className="relative min-w-0 flex-1 basis-52">
					<Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
					<Input type="search" value={q} maxLength={80} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Search recipients for personalization" placeholder="Find a name or email" className="pl-9" />
				</div>
				<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={missingOnly} onChange={(e) => { setMissingOnly(e.target.checked); setPage(0); }} className="accent-primary" />Missing fields only</label>
			</div>
			<p role="status" className="text-sm text-muted-foreground">{loading ? "Checking recipients…" : result ? `${result.total} recipients checked · ${result.missingCount} with missing fields` : "Choose an audience to check its fields."}</p>
			{!tags.length ? <p className="text-sm">This email has no merge fields yet. Add one to the subject or content to personalize it.</p> : null}
			{error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">{error}<Button size="sm" variant="outline" onClick={() => setRetry((v) => v + 1)}>Try again</Button></div> : null}
			<div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
				<div className="min-w-0">
					<ul className="max-h-80 divide-y divide-border overflow-y-auto border-y border-border" aria-label="Receiving audience">
						{result?.rows.map((person) => (
							<li key={person.email}><button type="button" onClick={() => setSelected(person)} aria-pressed={selected?.email === person.email} className={cn("grid w-full min-w-0 gap-1 px-2 py-3 text-left hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", selected?.email === person.email && "bg-secondary")}>
								<span className="break-words font-medium">{person.name}</span><span className="break-all text-xs text-muted-foreground">{person.email}{person.external ? " · Outside CODE" : ""}</span>
								<span className="text-xs text-muted-foreground">{person.missing.length ? `Missing: ${person.missing.map((t) => MERGE_TAG_LABELS[t]).join(", ")}` : tags.length ? "All fields filled" : "No fields used"}</span>
							</button></li>
						))}
					</ul>
					{result && !result.rows.length ? <p className="py-4 text-sm text-muted-foreground">{result.total ? "No recipients match these filters." : "No receiving recipients. Choose an audience first."}</p> : null}
					{result && result.filtered > 25 ? <div className="mt-3 flex items-center justify-between gap-2 text-sm"><Button size="sm" variant="outline" disabled={result.page === 0 || loading} onClick={() => setPage(result.page - 1)}><ChevronLeft />Previous</Button><span className="tabular-nums">{result.page * 25 + 1}–{Math.min((result.page + 1) * 25, result.filtered)} of {result.filtered}</span><Button size="sm" variant="outline" disabled={(result.page + 1) * 25 >= result.filtered || loading} onClick={() => setPage(result.page + 1)}>Next<ChevronRight /></Button></div> : null}
				</div>
				{selected && rendered && values ? <div className="grid min-w-0 content-start gap-4">
					<div><h3 className="break-words font-heading text-xl">Preview for {selected.name}</h3><p className="break-all text-sm text-muted-foreground">{selected.email}</p></div>
					<div className="grid gap-3 sm:grid-cols-2">{tags.map((tag) => <label key={tag} className="grid min-w-0 gap-1 text-sm"><span>{MERGE_TAG_LABELS[tag]}{tag !== "email" && Object.hasOwn(overrides[selected.email.toLowerCase()] ?? {}, tag) ? " · corrected" : ""}</span><Input value={values[tag]} maxLength={200} readOnly={tag === "email"} onChange={(e) => { if (tag !== "email") update(tag, e.target.value); }} /></label>)}</div>
					{overrides[selected.email.toLowerCase()] ? <Button variant="ghost" size="sm" className="w-fit" onClick={reset}><RotateCcw />Use profile values</Button> : null}
					<dl className="grid gap-2 border-y border-border py-3 text-sm"><div><dt className="text-muted-foreground">Subject</dt><dd className="break-words font-medium">{rendered.subject || "No subject"}</dd></div><div><dt className="text-muted-foreground">Preview text</dt><dd className="break-words">{rendered.preheader || "None"}</dd></div></dl>
					<iframe title={`Email preview for ${selected.email}`} sandbox="" srcDoc={rendered.html} className="h-[32rem] w-full rounded-lg border border-border bg-white" />
				</div> : <p className="py-4 text-sm text-muted-foreground">Select a recipient to preview their email and correct any field.</p>}
			</div>
		</div>
	);
}

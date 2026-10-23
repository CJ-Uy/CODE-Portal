"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CircleAlert, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PersonalizationPreview } from "@/db/repositories/email-campaigns";
import { isMergeTag, mergeLabel, type MergeOverrides, type MergeSheet } from "@/lib/email/merge";
import { renderEmail, valueResolver, type FooterInput } from "@/lib/email/render";
import { recipientsCsv } from "@/lib/email/sheet";
import type { Audience, EmailBlock } from "@/lib/email/types";
import { cn } from "@/lib/utils";
import { previewPersonalizationAction, sheetRecipientsAction } from "./actions";
import { MergeSheetPanel } from "./merge-sheet";

type Person = PersonalizationPreview["rows"][number];

export function Personalization({ audience, categoryId, tags, overrides, onChange, sheet, onSheetChange, onPreview, subject, preheader, blocks, baseUrl, footer }: {
	audience: Audience; categoryId: string | null; tags: string[]; overrides: MergeOverrides; onChange: (value: MergeOverrides) => void;
	sheet: MergeSheet | null; onSheetChange: (value: MergeSheet | null) => void;
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
				const response = await previewPersonalizationAction({ audience, categoryId, tags, overrides, sheet, q, missingOnly, page });
				if (cancelled) return;
				if (!response.ok) return setError(response.error);
				setResult(response.data);
				onPreview(response.data);
				setSelected((old) => old ? response.data.rows.find((r) => r.email === old.email) ?? old : null);
			} catch { if (!cancelled) setError("Could not check recipients. Try again."); }
			finally { if (!cancelled) setLoading(false); }
		}, 250);
		return () => { cancelled = true; window.clearTimeout(timeout); };
	}, [audience, categoryId, tags, overrides, sheet, q, missingOnly, page, retry, onPreview]);

	const key = selected?.email.toLowerCase() ?? "";
	const values = useMemo(() => selected ? { ...selected.sourceValues, ...overrides[key] } : null, [selected, overrides, key]);
	const rendered = useMemo(() => values ? renderEmail({ subject, preheader, blocks, baseUrl, footer: selected?.external ? { ...footer, guest: true, archiveUrl: null, unsubscribeUrl: null } : footer, values, resolve: valueResolver(values) }) : null, [subject, preheader, blocks, baseUrl, footer, values, selected?.external]);
	const headerOf = (tag: string) => sheet?.columns.find((c) => c.variable === tag && !isMergeTag(tag))?.header ?? mergeLabel(tag);
	const update = (tag: string, value: string) => {
		if (!selected || tag === "email") return;
		onChange({ ...overrides, [key]: { ...overrides[key], [tag]: value } });
	};
	const download = async () => {
		try {
			const response = await sheetRecipientsAction(audience, categoryId);
			if (!response.ok) return response.error;
			if (!response.data.length) return "No one receives this email yet. Choose an audience first.";
			// The byte-order mark makes Excel read the file as UTF-8, so names with ñ survive.
			const url = URL.createObjectURL(new Blob(["﻿", recipientsCsv(response.data, sheet, tags)], { type: "text/csv;charset=utf-8" }));
			const link = Object.assign(document.createElement("a"), { href: url, download: `${(subject.replace(/\{\{[^}]*\}\}/g, "").trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "email")}-recipients.csv` });
			link.click();
			URL.revokeObjectURL(url);
			return null;
		} catch {
			return "Could not prepare the recipient list. Try again.";
		}
	};
	const reset = () => {
		if (!selected) return;
		const next = { ...overrides };
		delete next[key];
		onChange(next);
	};

	return (
		<div className="grid gap-6">
			<section className="grid gap-3" aria-labelledby="sheet-heading">
				<h3 id="sheet-heading" className="font-medium">Values from a sheet</h3>
				<MergeSheetPanel sheet={sheet} onChange={onSheetChange} match={result?.sheet ?? null} tags={tags} onDownload={download} />
			</section>

			<section className="grid gap-4 border-t border-border pt-5" aria-labelledby="recipients-heading">
				<div className="grid gap-1">
					<h3 id="recipients-heading" className="font-medium">Recipients</h3>
					<p className="text-sm text-muted-foreground">Check each person&apos;s values before sending. Edits stay in this email.</p>
				</div>
				{result?.unknown.length ? (
					<p role="alert" className="flex items-start gap-2 rounded-lg border border-[#90B4CC] bg-secondary/50 p-3 text-sm">
						<CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
						<span className="min-w-0 [overflow-wrap:anywhere]">Nothing fills {result.unknown.map((t) => `{{${t}}}`).join(", ")}. Import a sheet with {result.unknown.length === 1 ? "that column" : "those columns"}, or remove {result.unknown.length === 1 ? "it" : "them"} from the email. The email cannot be sent until then.</span>
					</p>
				) : null}
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
									<span className="text-xs text-muted-foreground">{person.missing.length ? `Missing: ${person.missing.map(headerOf).join(", ")}` : tags.length ? "All fields filled" : "No fields used"}</span>
								</button></li>
							))}
						</ul>
						{result && !result.rows.length ? <p className="py-4 text-sm text-muted-foreground">{result.total ? "No recipients match these filters." : "No receiving recipients. Choose an audience first."}</p> : null}
						{result && result.filtered > 25 ? <div className="mt-3 flex items-center justify-between gap-2 text-sm"><Button size="sm" variant="outline" disabled={result.page === 0 || loading} onClick={() => setPage(result.page - 1)}><ChevronLeft />Previous</Button><span className="tabular-nums">{result.page * 25 + 1}–{Math.min((result.page + 1) * 25, result.filtered)} of {result.filtered}</span><Button size="sm" variant="outline" disabled={(result.page + 1) * 25 >= result.filtered || loading} onClick={() => setPage(result.page + 1)}>Next<ChevronRight /></Button></div> : null}
					</div>
					{selected && rendered && values ? <div className="grid min-w-0 content-start gap-4">
						<div><h4 className="break-words font-heading text-xl">Preview for {selected.name}</h4><p className="break-all text-sm text-muted-foreground">{selected.email}</p></div>
						<div className="grid gap-3 sm:grid-cols-2">{tags.map((tag) => {
							const corrected = tag !== "email" && Object.hasOwn(overrides[key] ?? {}, tag);
							const fromSheet = !corrected && Boolean(sheet?.rows[key]?.[tag]?.trim());
							const label = `${headerOf(tag)}${corrected ? " · corrected" : fromSheet ? " · from sheet" : ""}`;
							return isMergeTag(tag)
								? <label key={tag} className="grid min-w-0 gap-1 text-sm"><span>{label}</span><Input value={values[tag] ?? ""} maxLength={200} readOnly={tag === "email"} onChange={(e) => update(tag, e.target.value)} /></label>
								: <label key={tag} className="grid min-w-0 gap-1 text-sm sm:col-span-2"><span className="[overflow-wrap:anywhere]">{label}</span><Textarea rows={3} value={values[tag] ?? ""} maxLength={2000} onChange={(e) => update(tag, e.target.value)} className="min-h-16" /></label>;
						})}</div>
						{overrides[key] ? <Button variant="ghost" size="sm" className="w-fit" onClick={reset}><RotateCcw />Clear corrections</Button> : null}
						<dl className="grid gap-2 border-y border-border py-3 text-sm"><div><dt className="text-muted-foreground">Subject</dt><dd className="break-words font-medium">{rendered.subject || "No subject"}</dd></div><div><dt className="text-muted-foreground">Preview text</dt><dd className="break-words">{rendered.preheader || "None"}</dd></div></dl>
						<iframe title={`Email preview for ${selected.email}`} sandbox="" srcDoc={rendered.html} className="h-[32rem] w-full rounded-lg border border-border bg-white" />
					</div> : <p className="py-4 text-sm text-muted-foreground">Select a recipient to preview their email and correct any field.</p>}
				</div>
			</section>
		</div>
	);
}

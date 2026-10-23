"use client";

import { useId, useRef, useState } from "react";
import { Download, FileSpreadsheet, RefreshCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isMergeTag, type MergeSheet } from "@/lib/email/merge";
import { buildSheet, parseDelimited, parseXlsx, SHEET_LIMITS, type SheetImport, type SheetMatch } from "@/lib/email/sheet";

const DATE = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

type Props = {
	sheet: MergeSheet | null;
	onChange: (sheet: MergeSheet | null) => void;
	match: SheetMatch | null;
	tags: string[];
	/** Downloads the receiving audience as a CSV to fill in. Resolves to an error message, or null. */
	onDownload: () => Promise<string | null>;
};

/** Paste or upload spreadsheet rows; each column becomes a merge field matched to recipients by email. */
export function MergeSheetPanel({ sheet, onChange, match, tags, onDownload }: Props) {
	const pasteId = useId();
	const fileRef = useRef<HTMLInputElement>(null);
	const [editing, setEditing] = useState(false);
	const [paste, setPaste] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState<"" | "reading" | "downloading">("");
	// What the last import skipped. Kept for this session only; the saved sheet holds the usable rows.
	const [notes, setNotes] = useState<SheetImport | null>(null);

	const apply = (table: string[][], name: string) => {
		try {
			const result = buildSheet(table, name);
			if (!Object.keys(result.sheet.rows).length) throw new Error(`No row has an email address in the "${result.sheet.keyColumn}" column. Copy the header row and a column of email addresses.`);
			if (!result.sheet.columns.length) throw new Error("Add at least one column besides the email column.");
			if (JSON.stringify(result.sheet).length > SHEET_LIMITS.bytes) throw new Error("This sheet is too large to save with the email. Remove columns or rows you do not use.");
			onChange(result.sheet);
			setNotes(result);
			setEditing(false);
			setPaste("");
			setError("");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not read these cells.");
		}
	};

	const readFile = async (file: File) => {
		setBusy("reading");
		setError("");
		try {
			if (file.size > 5_000_000) throw new Error("Use a file under 5 MB.");
			if (/\.xls$/i.test(file.name)) throw new Error("Save the workbook as .xlsx or .csv first. Older .xls files cannot be read.");
			const table = /\.xlsx$/i.test(file.name) ? await parseXlsx(new Uint8Array(await file.arrayBuffer())) : parseDelimited(await file.text());
			apply(table, file.name);
		} catch (e) {
			setError(e instanceof Error && !(e instanceof RangeError) ? e.message : "Could not read this file. Save it as .xlsx or .csv and try again.");
		} finally {
			setBusy("");
		}
	};

	const download = async () => {
		setBusy("downloading");
		setError((await onDownload()) ?? "");
		setBusy("");
	};

	const downloadButton = (
		<Button size="sm" variant="ghost" disabled={busy === "downloading"} onClick={download}>
			<Download />
			{busy === "downloading" ? "Preparing..." : sheet ? "Download to edit" : "Download recipients"}
		</Button>
	);
	const errorLine = error ? (
		<p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
			{error}
		</p>
	) : null;

	if (!sheet && !editing) {
		return (
			<div className="grid gap-2">
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-3">
					<div className="flex min-w-0 items-center gap-3">
						<FileSpreadsheet className="size-5 shrink-0 text-muted-foreground" aria-hidden />
						<div className="grid min-w-0">
							<span className="font-medium">Add values from a spreadsheet</span>
							<span className="text-sm text-muted-foreground">For fields like a batch or a personal message.</span>
						</div>
					</div>
					<div className="flex flex-wrap gap-2">
						{downloadButton}
						<Button size="sm" variant="outline" onClick={() => setEditing(true)}>
							Add a sheet
						</Button>
					</div>
				</div>
				{errorLine}
			</div>
		);
	}

	if (editing) {
		return (
			<div className="grid gap-3">
				<label htmlFor={pasteId} className="grid gap-1">
					<span className="text-sm font-medium">Paste cells, header row first</span>
					<span className="text-sm text-muted-foreground">One column holds emails. Each other column becomes a field, like {"{{message}}"}.</span>
				</label>
				<Textarea
					id={pasteId}
					rows={5}
					value={paste}
					spellCheck={false}
					wrap="off"
					autoFocus
					onChange={(e) => setPaste(e.target.value)}
					onPaste={(e) => {
						const text = e.clipboardData.getData("text/plain");
						// Cells copied from a spreadsheet arrive tab-separated: read them straight away.
						if (text.includes("\t")) {
							e.preventDefault();
							apply(parseDelimited(text, "\t"), "Pasted cells");
						}
					}}
					placeholder={"Email\tBatch\tMessage\njuan.delacruz@student.ateneo.edu\t2027\tSee you at the GA on Friday."}
					className="font-mono text-xs leading-5"
				/>
				<div className="flex flex-wrap items-center gap-2">
					<Button size="sm" disabled={!paste.trim()} onClick={() => apply(parseDelimited(paste), "Pasted cells")}>
						Use these cells
					</Button>
					<Button size="sm" variant="outline" disabled={busy === "reading"} onClick={() => fileRef.current?.click()}>
						<Upload />
						{busy === "reading" ? "Reading file..." : "Upload CSV or XLSX"}
					</Button>
					<input
						ref={fileRef}
						type="file"
						accept=".csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
						className="sr-only"
						tabIndex={-1}
						aria-hidden
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) void readFile(file);
							e.target.value = "";
						}}
					/>
					<Button size="sm" variant="ghost" onClick={() => { setEditing(false); setError(""); }}>
						Cancel
					</Button>
				</div>
				{errorLine}
				<details className="text-sm text-muted-foreground">
					<summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Sheet tips</summary>
					<ul className="mt-2 grid list-disc gap-1 pl-5">
						<li>Start from Download recipients to get every address in this audience, then fill in your columns.</li>
						<li>Up to {SHEET_LIMITS.rows.toLocaleString()} rows and {SHEET_LIMITS.columns} columns. Only the first sheet of a workbook is read.</li>
						<li>Format date columns as text so they keep their look. Save older .xls files as .xlsx first.</li>
					</ul>
				</details>
			</div>
		);
	}

	if (!sheet) return null;
	const rows = Object.keys(sheet.rows).length;
	return (
		<div className="grid gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex min-w-0 items-start gap-3">
					<FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
					<div className="grid min-w-0">
						<span className="font-medium [overflow-wrap:anywhere]">{sheet.name}</span>
						<span className="text-sm text-muted-foreground">
							{plural(rows, "row", "rows")} · matched by {sheet.keyColumn} · added {DATE.format(new Date(sheet.importedAt))}
						</span>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					{downloadButton}
					<Button size="sm" variant="outline" onClick={() => setEditing(true)}>
						<RefreshCw />
						Replace
					</Button>
					<Button size="sm" variant="ghost" onClick={() => { onChange(null); setNotes(null); }}>
						<Trash2 />
						Remove
					</Button>
				</div>
			</div>
			{errorLine}

			<p role="status" className="text-sm">
				{match ? (
					<>
						<span className="font-semibold tabular-nums">{match.matched.toLocaleString()}</span> of {plural(match.rows, "row matches", "rows match")} a recipient
						{match.unmatchedCount ? <> · <span className="tabular-nums">{match.unmatchedCount.toLocaleString()}</span> match no one</> : null}
						{match.withoutRow ? <> · <span className="tabular-nums">{plural(match.withoutRow, "recipient has", "recipients have")}</span> no row</> : null}
					</>
				) : (
					"Checking the sheet against the audience..."
				)}
			</p>

			<ul className="divide-y divide-border rounded-lg border border-border" aria-label="Sheet columns">
				{sheet.columns.map((column) => {
					const used = tags.includes(column.variable);
					const missing = match?.missing.find((m) => m.variable === column.variable)?.count ?? 0;
					const status = !used
						? "Not in the email yet"
						: isMergeTag(column.variable)
							? "In the email · replaces profile values where filled"
							: missing
								? `In the email · ${plural(missing, "recipient has", "recipients have")} no value`
								: "In the email · every recipient has a value";
					return (
						<li key={column.variable} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
							<span className="grid min-w-0">
								<span className="font-medium [overflow-wrap:anywhere]">{column.header}</span>
								<span className="text-xs text-muted-foreground">{status}</span>
							</span>
							<code className="justify-self-start rounded-md bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground [overflow-wrap:anywhere]">{`{{${column.variable}}}`}</code>
						</li>
					);
				})}
			</ul>

			{match?.unmatchedCount ? (
				<details className="group rounded-lg border border-border">
					<summary className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
						{plural(match.unmatchedCount, "row matches", "rows match")} no one in this audience
					</summary>
					<div className="grid gap-2 border-t border-border px-3 py-2.5 text-sm">
						<p className="text-muted-foreground">Not in the audience, turned this category off, or a different address in CODE.</p>
						<ul className="grid gap-0.5">
							{match.unmatched.map((email) => (
								<li key={email} className="break-all">{email}</li>
							))}
						</ul>
						{match.unmatchedCount > match.unmatched.length ? <p className="text-muted-foreground">and {(match.unmatchedCount - match.unmatched.length).toLocaleString()} more</p> : null}
					</div>
				</details>
			) : null}

			{notes && (notes.invalid.length || notes.duplicates.length || notes.extraColumns) ? (
				<ul className="grid gap-1 text-sm text-muted-foreground" aria-label="Skipped while importing">
					{notes.invalid.length ? (
						<li>
							Skipped {plural(notes.invalid.length, "row", "rows")} without an email address: {notes.invalid.slice(0, 8).map((r) => `row ${r.row}`).join(", ")}
							{notes.invalid.length > 8 ? " and more" : ""}.
						</li>
					) : null}
					{notes.duplicates.length ? (
						<li className="[overflow-wrap:anywhere]">
							{notes.duplicates.slice(0, 3).join(", ")}
							{notes.duplicates.length > 3 ? ` and ${notes.duplicates.length - 3} more` : ""} {notes.duplicates.length === 1 ? "appears" : "appear"} more than once. The last row is used.
						</li>
					) : null}
					{notes.extraColumns ? <li>Left out {plural(notes.extraColumns, "column", "columns")} past the {SHEET_LIMITS.columns}-column limit.</li> : null}
				</ul>
			) : null}
		</div>
	);
}

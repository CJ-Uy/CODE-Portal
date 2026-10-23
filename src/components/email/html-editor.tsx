"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ClipboardCopy, Contrast, Info, Monitor, Moon, ShieldX, Smartphone, Sun, TriangleAlert } from "lucide-react";
import { baseHtmlTemplate } from "@/lib/email/base-html";
import { HTML_MAX, lintEmailHtml, previewDocument, type PreviewScheme } from "@/lib/email/html";
import { isMergeTag, MERGE_TAGS } from "@/lib/email/merge";
import { renderEmail, valueResolver, type FooterInput } from "@/lib/email/render";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Segmented, type PreviewPerson } from "./block-editor";
import { TaggedField, type SheetField } from "./tagged-field";

const LEVELS = [
	{ level: "removed", title: "Removed when sent", icon: ShieldX },
	{ level: "unsupported", title: "Not supported in every inbox", icon: TriangleAlert },
	{ level: "tip", title: "Tips", icon: Info },
] as const;

const SCHEME_NOTE: Record<PreviewScheme, string> = {
	light: "As most inboxes show it. Web fonts and remote CSS are blocked here, as they are in Gmail and Outlook.",
	dark: "Your prefers-color-scheme rules switched on, as Apple Mail and iOS Mail do.",
	forced: "Colors inverted without your rules, as the Gmail app and Outlook do in dark mode. Images keep their colors.",
};

type Props = {
	html: string;
	onChange: (html: string) => void;
	subject: string;
	preheader: string;
	baseUrl: string;
	footer: FooterInput;
	people: PreviewPerson[];
	fields?: SheetField[];
	/** Where sheet columns come from, for the field notes. Templates have none. */
	sheetNote: string;
	layout?: "wide" | "compact";
};

export function HtmlEditor({ html, onChange, subject, preheader, baseUrl, footer, people, fields = [], sheetNote, layout = "wide" }: Props) {
	const toast = useToast();
	const [person, setPerson] = useState(0);
	const [width, setWidth] = useState<600 | 375>(600);
	const [scheme, setScheme] = useState<PreviewScheme>("light");
	const [confirmReplace, setConfirmReplace] = useState(false);
	// Rendering and checking a large document on every keystroke is wasted work; the preview trails typing slightly.
	const [source, setSource] = useState(html);
	useEffect(() => {
		const timeout = window.setTimeout(() => setSource(html), 250);
		return () => window.clearTimeout(timeout);
	}, [html]);

	const issues = useMemo(() => lintEmailHtml(source), [source]);
	const values = (people[person] ?? people[0]).values;
	const srcDoc = useMemo(() => {
		const rendered = renderEmail({ subject, preheader, blocks: [{ id: "preview", type: "html", props: { html: source } }], values, resolve: valueResolver(values), baseUrl, footer });
		return previewDocument(rendered.html, scheme);
	}, [subject, preheader, source, values, baseUrl, footer, scheme]);
	const template = useMemo(() => baseHtmlTemplate(baseUrl), [baseUrl]);
	const kb = new TextEncoder().encode(html).length / 1000;
	const sheetFields = fields.filter((f) => !isMergeTag(f.variable));

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(template);
			toast({ message: "Base template copied." });
		} catch {
			toast({ message: "Could not copy. Select the template text and copy it instead." });
		}
	};
	const replace = () => {
		if (html.trim() && html !== template && !confirmReplace) return setConfirmReplace(true);
		onChange(template);
		setConfirmReplace(false);
	};

	const editor = (
		<TaggedField
			code
			label="HTML and CSS"
			value={html}
			onChange={onChange}
			rows={layout === "wide" ? 26 : 16}
			maxLength={HTML_MAX}
			fields={fields}
			placeholder="<!doctype html>"
			hint={`${kb.toFixed(1)} KB of ${HTML_MAX / 1000} KB. Paste a full document or a fragment. On send, scripts, comments and unsafe links are removed and <style> rules are copied inline.`}
		/>
	);

	const checks = (
		<section aria-label="Inbox checks" className="grid gap-3 rounded-xl border border-border bg-card p-4">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h3 className="font-medium">Inbox checks</h3>
				<span role="status" className="text-sm tabular-nums text-muted-foreground">
					{issues.length ? `${issues.length} to review` : "Nothing to fix"}
				</span>
			</div>
			{issues.length === 0 ? (
				<p className="flex items-start gap-2 text-sm text-muted-foreground">
					<Check className="mt-0.5 size-4 shrink-0" aria-hidden />
					Nothing here is removed or unsupported. Table layouts, inline styles and https links work across inboxes.
				</p>
			) : (
				LEVELS.map(({ level, title, icon: Icon }) => {
					const items = issues.filter((issue) => issue.level === level);
					if (!items.length) return null;
					return (
						<div key={level} className="grid gap-1.5">
							<h4 className="flex items-center gap-1.5 text-sm font-medium">
								<Icon className="size-4 shrink-0" aria-hidden />
								{title}
							</h4>
							<ul className="grid list-disc gap-1 pl-10 text-sm text-muted-foreground marker:text-border">
								{items.map((issue) => (
									<li key={issue.id} className="[overflow-wrap:anywhere]">{issue.message}</li>
								))}
							</ul>
						</div>
					);
				})
			)}
		</section>
	);

	const preview = (
		<section aria-label="Preview" className="grid min-w-0 content-start gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<select aria-label="Preview as" value={person} onChange={(e) => setPerson(Number(e.target.value))} className="h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm">
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
				<Segmented
					label="Color scheme"
					value={scheme}
					onChange={setScheme}
					options={[
						{ value: "light", label: <><Sun className="size-3.5" aria-hidden /> Light</> },
						{ value: "dark", label: <><Moon className="size-3.5" aria-hidden /> Dark</> },
						{ value: "forced", label: <><Contrast className="size-3.5" aria-hidden /> Forced dark</> },
					]}
				/>
			</div>
			<p className="text-xs text-muted-foreground">{SCHEME_NOTE[scheme]}</p>
			<div className="overflow-x-auto rounded-xl bg-[#F5F5F6] p-2 sm:p-3">
				<iframe
					title="HTML email preview"
					sandbox=""
					srcDoc={srcDoc}
					style={{ width: width === 375 ? 375 : "100%" }}
					className={cn("mx-auto block rounded-lg border border-border bg-white transition-[width] duration-300 ease-out motion-reduce:transition-none", layout === "wide" ? "h-[44rem]" : "h-[36rem]")}
				/>
			</div>
		</section>
	);

	const base = (
		<details className="group rounded-xl border border-border bg-card">
			<summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
				<span className="grid min-w-0 gap-0.5">
					<span className="font-medium">Base HTML template</span>
					<span className="text-sm text-muted-foreground">A table-based starting point with dark mode, to copy into your AI tool.</span>
				</span>
				<ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" aria-hidden />
			</summary>
			<div className="grid gap-4 border-t border-border p-4">
				<ol className="grid list-decimal gap-1 pl-5 text-sm">
					<li>Copy the template and paste it into your AI tool.</li>
					<li>Describe the email you want: the message, its sections and links. Ask the tool to follow the rules in the comment at the top.</li>
					<li>Paste the result into the editor and check the light, dark and phone previews.</li>
				</ol>
				<div className="grid gap-2">
					<h3 className="text-sm font-medium">Fields you can use</h3>
					<ul className="flex flex-wrap gap-1.5" aria-label="Merge fields">
						{[...MERGE_TAGS, ...sheetFields.map((f) => f.variable)].map((tag) => (
							<li key={tag}>
								<code className="rounded-md bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">{`{{${tag}}}`}</code>
							</li>
						))}
					</ul>
					<p className="text-xs text-muted-foreground">{sheetNote}</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button size="sm" onClick={copy}>
						<ClipboardCopy />
						Copy template
					</Button>
					<Button size="sm" variant="outline" onClick={replace}>
						{confirmReplace ? "Replace your HTML" : "Put it in the editor"}
					</Button>
					{confirmReplace ? (
						<Button size="sm" variant="ghost" onClick={() => setConfirmReplace(false)}>
							Keep my HTML
						</Button>
					) : null}
				</div>
				<pre className="max-h-80 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-5" tabIndex={0} aria-label="Base HTML template source">
					<code>{template}</code>
				</pre>
			</div>
		</details>
	);

	if (layout === "compact") {
		return (
			<div className="grid min-w-0 gap-4">
				{editor}
				{checks}
				{preview}
				{base}
			</div>
		);
	}
	return (
		<div className="grid min-w-0 gap-4 xl:grid-cols-2">
			<div className="grid min-w-0 content-start gap-4">
				{editor}
				{checks}
				{base}
			</div>
			<div className="min-w-0 xl:sticky xl:top-6 xl:self-start">{preview}</div>
		</div>
	);
}

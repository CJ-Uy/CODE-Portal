"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ClipboardCopy, Code2, Contrast, Copy, Info, Monitor, Moon, ShieldX, Smartphone, Sun, TriangleAlert } from "lucide-react";
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
	light: "How most inboxes show it.",
	dark: "Apple Mail, using your dark-mode styles.",
	forced: "The Gmail app, which inverts colors on its own.",
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

	const empty = !html.trim();
	const issues = useMemo(() => lintEmailHtml(source), [source]);
	const values = (people[person] ?? people[0]).values;
	const srcDoc = useMemo(() => {
		const rendered = renderEmail({ subject, preheader, blocks: [{ id: "preview", type: "html", props: { html: source } }], values, resolve: valueResolver(values), baseUrl, footer });
		return previewDocument(rendered.html, scheme);
	}, [subject, preheader, source, values, baseUrl, footer, scheme]);
	const template = useMemo(() => baseHtmlTemplate(baseUrl), [baseUrl]);
	const kb = new TextEncoder().encode(html).length / 1000;
	const sheetFields = fields.filter((f) => !isMergeTag(f.variable));

	const copy = async (text: string, done: string) => {
		try {
			await navigator.clipboard.writeText(text);
			toast({ message: done });
		} catch {
			toast({ message: "Could not copy. Select the text and copy it instead." });
		}
	};
	const useTemplate = () => {
		if (!empty && html !== template && !confirmReplace) return setConfirmReplace(true);
		onChange(template);
		setConfirmReplace(false);
	};

	const editor = (
		<TaggedField
			code
			label="HTML and CSS"
			value={html}
			onChange={onChange}
			rows={empty ? 6 : layout === "wide" ? 24 : 14}
			maxLength={HTML_MAX}
			fields={fields}
			placeholder="Paste your email's HTML here"
			hint={empty ? undefined : `${kb.toFixed(1)} KB of ${HTML_MAX / 1000} KB`}
			actions={
				empty ? null : (
					<button type="button" onClick={() => copy(html, "HTML copied.")} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-accent transition-colors hover:bg-secondary">
						<Copy className="size-3.5" aria-hidden />
						Copy
					</button>
				)
			}
		/>
	);

	const start = (
		<section aria-label="Start an HTML email" className="grid justify-items-start gap-3 rounded-xl border border-dashed border-border p-5">
			<Code2 className="size-5 text-muted-foreground" aria-hidden />
			<div className="grid gap-1">
				<h3 className="font-medium">Paste HTML, or start from ours</h3>
				<p className="text-sm text-muted-foreground">The base template already works in Gmail, Outlook and dark mode.</p>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button size="sm" onClick={useTemplate}>
					Use the base template
				</Button>
				<Button size="sm" variant="outline" onClick={() => copy(template, "Base template copied. Paste it into your AI tool.")}>
					<ClipboardCopy />
					Copy it for an AI tool
				</Button>
			</div>
		</section>
	);

	const checks =
		issues.length === 0 ? (
			<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
				<Check className="size-4 shrink-0" aria-hidden />
				Ready for inboxes. Nothing will be removed.
			</p>
		) : (
			<section aria-label="Inbox checks" className="grid gap-3 rounded-xl border border-border bg-card p-4">
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<h3 className="font-medium">Inbox checks</h3>
					<span role="status" className="text-sm tabular-nums text-muted-foreground">
						{issues.length} to review
					</span>
				</div>
				{LEVELS.map(({ level, title, icon: Icon }) => {
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
				})}
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

	const help = (
		<details className="group rounded-xl border border-border bg-card">
			<summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
				<span className="grid min-w-0 gap-0.5">
					<span className="font-medium">Base HTML template</span>
					<span className="text-sm text-muted-foreground">A starting point, the fields you can use and what changes on send.</span>
				</span>
				<ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" aria-hidden />
			</summary>
			<div className="grid gap-5 border-t border-border p-4">
				<div className="grid gap-2">
					<h3 className="text-sm font-medium">With an AI tool</h3>
					<ol className="grid list-decimal gap-1 pl-5 text-sm">
						<li>Copy the base template into your AI tool.</li>
						<li>Describe the email you want. Ask it to keep the rules at the top of the file.</li>
						<li>Paste the result here and check Light, Dark and Phone.</li>
					</ol>
					<div className="flex flex-wrap items-center gap-2 pt-1">
						<Button size="sm" onClick={() => copy(template, "Base template copied. Paste it into your AI tool.")}>
							<ClipboardCopy />
							Copy template
						</Button>
						<Button size="sm" variant="outline" onClick={useTemplate}>
							{confirmReplace ? "Replace your HTML" : "Put it in the editor"}
						</Button>
						{confirmReplace ? (
							<Button size="sm" variant="ghost" onClick={() => setConfirmReplace(false)}>
								Keep my HTML
							</Button>
						) : null}
					</div>
				</div>
				<div className="grid gap-2">
					<h3 className="text-sm font-medium">Fields</h3>
					<ul className="flex flex-wrap gap-1.5" aria-label="Merge fields">
						{[...MERGE_TAGS, ...sheetFields.map((f) => f.variable)].map((tag) => (
							<li key={tag}>
								<code className="rounded-md bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">{`{{${tag}}}`}</code>
							</li>
						))}
					</ul>
					<p className="text-xs text-muted-foreground">{sheetNote}</p>
				</div>
				<div className="grid gap-2">
					<h3 className="text-sm font-medium">When it sends</h3>
					<ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
						<li>Scripts, forms, comments and links that are not https or mailto are removed.</li>
						<li>Rules in &lt;style&gt; are copied onto each element, so inboxes that drop &lt;style&gt; still get them.</li>
						<li>CODE adds the footer with preferences and unsubscribe links.</li>
						<li>The preview blocks web fonts, as Gmail and Outlook do.</li>
					</ul>
				</div>
				<details className="group/code">
					<summary className="w-fit cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Show the template code</summary>
					<pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-5" tabIndex={0} aria-label="Base HTML template source">
						<code>{template}</code>
					</pre>
				</details>
			</div>
		</details>
	);

	if (empty) {
		return (
			<div className="grid min-w-0 gap-4">
				{start}
				{editor}
				{help}
			</div>
		);
	}
	if (layout === "compact") {
		return (
			<div className="grid min-w-0 gap-4">
				{editor}
				{checks}
				{preview}
				{help}
			</div>
		);
	}
	return (
		<div className="grid min-w-0 gap-4 xl:grid-cols-2">
			<div className="grid min-w-0 content-start gap-4">
				{editor}
				{checks}
				{help}
			</div>
			<div className="min-w-0 xl:sticky xl:top-6 xl:self-start">{preview}</div>
		</div>
	);
}

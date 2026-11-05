"use client";

import { useState } from "react";
import { LayoutTemplate, Search, SearchX } from "lucide-react";
import { EmailPreview } from "@/components/email/email-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SAMPLE_MERGE_VALUES } from "@/lib/email/merge";
import { renderEmail, valueResolver, type FooterInput } from "@/lib/email/render";
import { searchTemplates, type PickerTemplate } from "@/lib/email/template-search";
import { cn } from "@/lib/utils";

/**
 * A searchable list beside a live preview, replacing a wall of name chips where same-named starters and
 * saved copies looked identical. Built-in starters carry ids prefixed "starter:".
 */
export function TemplatePicker({ templates, baseUrl, footer, onPick }: { templates: PickerTemplate[]; baseUrl: string; footer: FooterInput; onPick: (id: string) => void }) {
	const [q, setQ] = useState("");
	const [selectedId, setSelectedId] = useState(templates[0]?.id ?? null);
	const shown = searchTemplates(templates, q);
	// Keep the preview on a visible template, so a search never previews something the list hides.
	const selected = shown.find((t) => t.id === selectedId) ?? shown[0] ?? null;
	const groups = [
		{ label: "CODE starters", items: shown.filter((t) => t.id.startsWith("starter:")) },
		{ label: "Saved templates", items: shown.filter((t) => !t.id.startsWith("starter:")) },
	].filter((group) => group.items.length);

	const rendered = selected
		? renderEmail({
				subject: selected.subject,
				preheader: selected.preheader,
				blocks: selected.blocks,
				resolve: valueResolver(SAMPLE_MERGE_VALUES),
				values: SAMPLE_MERGE_VALUES,
				baseUrl,
				footer,
			})
		: null;

	return (
		<section aria-labelledby="template-picker-title" className="row-enter @container grid min-w-0 gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
			<div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
				<h2 id="template-picker-title" className="flex items-center gap-2 text-sm font-semibold">
					<LayoutTemplate className="size-4 text-muted-foreground" aria-hidden />
					Start from a template
				</h2>
				<div role="search" className="relative min-w-0 flex-[1_1_14rem] sm:max-w-xs">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
					<Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" aria-label="Search templates" className="h-9 pl-8" />
				</div>
			</div>

			{shown.length === 0 ? (
				<p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
					<SearchX className="size-4" aria-hidden />
					No templates match “{q}”.
				</p>
			) : (
				<div className="grid min-w-0 gap-3 @2xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
					<div className="grid max-h-56 min-w-0 content-start gap-3 overflow-y-auto overscroll-contain @2xl:max-h-[30rem]">
						{groups.map((group) => (
							<div key={group.label} className="grid min-w-0 gap-1">
								<p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
								{group.items.map((t) => {
									const active = t.id === selected?.id;
									return (
										<button
											key={t.id}
											type="button"
											aria-pressed={active}
											onClick={() => setSelectedId(t.id)}
											className={cn(
												"grid min-w-0 gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
												active ? "bg-secondary" : "hover:bg-secondary/60",
											)}
										>
											<span className="truncate text-sm font-medium">{t.name}</span>
											<span className="truncate text-xs text-muted-foreground">{t.description || t.subject || "No subject"}</span>
										</button>
									);
								})}
							</div>
						))}
					</div>

					{selected && rendered ? (
						<div className="grid min-w-0 content-start gap-2">
							<div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
								<div className="grid min-w-0">
									<span className="truncate text-sm font-medium">{selected.subject || "No subject"}</span>
									<span className="truncate text-xs text-muted-foreground">{selected.preheader}</span>
								</div>
								<Button type="button" size="sm" onClick={() => onPick(selected.id)}>
									Use this template
								</Button>
							</div>
							<div className="max-h-[26rem] min-w-0 overflow-y-auto overscroll-contain rounded-xl">
								{/* inert keeps the preview's links from navigating; the scroller stays outside it so it still scrolls. */}
								<div inert>
									<EmailPreview email={rendered} />
								</div>
							</div>
						</div>
					) : null}
				</div>
			)}
		</section>
	);
}

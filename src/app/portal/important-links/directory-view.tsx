"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, Search, X } from "lucide-react";
import { LinkKindTile } from "@/components/portal/link-kind-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LINK_KIND_LABELS } from "@/lib/link-kinds";
import { countLinks, filterSections, type DirectoryLink, type DirectorySection } from "./directory";

// Below this many links the whole list fits on a screen or two, and a search box is only clutter.
const SEARCH_FROM = 6;

export function DirectoryView({ sections }: { sections: DirectorySection[] }) {
	const [query, setQuery] = useState("");
	const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const searchId = useId();
	const total = countLinks(sections);
	const visible = filterSections(sections, query);
	const found = countLinks(visible);

	useEffect(() => {
		if (!copied) return;
		// The failure message tells people what to do instead, so it stays long enough to read.
		const timer = window.setTimeout(() => setCopied(null), copied.ok ? 2000 : 6000);
		return () => window.clearTimeout(timer);
	}, [copied]);

	// Both clear buttons hand focus back to the field, since the empty-state one disappears once the list returns.
	function clearSearch() {
		setQuery("");
		searchRef.current?.focus();
	}

	async function copy(link: DirectoryLink) {
		let ok = false;
		try {
			await navigator.clipboard.writeText(link.url);
			ok = true;
		} catch {
			// In-app browsers (Messenger, Instagram) often block the Clipboard API but still allow the older copy command.
			const field = document.createElement("textarea");
			field.value = link.url;
			field.setAttribute("readonly", "");
			field.style.position = "fixed";
			field.style.opacity = "0";
			document.body.appendChild(field);
			field.select();
			ok = document.execCommand("copy");
			field.remove();
		}
		setCopied({ id: link.id, ok });
	}

	return (
		<div className="grid min-w-0 gap-6">
			{total >= SEARCH_FROM ? (
				<div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
					<div className="relative w-full min-w-0 sm:max-w-md">
						<label htmlFor={searchId} className="sr-only">
							Search important links
						</label>
						<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
						<Input
							ref={searchRef}
							id={searchId}
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search by name, type or site"
							className="h-11 bg-card pl-10 pr-11 [&::-webkit-search-cancel-button]:appearance-none"
						/>
						{query ? (
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="absolute right-1 top-1/2 size-9 -translate-y-1/2 text-muted-foreground hover:bg-secondary hover:text-accent"
								aria-label="Clear search"
								onClick={clearSearch}
							>
								<X aria-hidden />
							</Button>
						) : null}
					</div>
					<p className="text-sm text-muted-foreground" role="status">
						{query.trim() ? `${found} of ${total} links` : `${total} links`}
					</p>
				</div>
			) : null}

			{visible.length === 0 ? (
				<div className="grid justify-items-start gap-2 rounded-xl border border-dashed border-border px-5 py-8">
					<h2 className="text-xl font-semibold text-primary [overflow-wrap:anywhere]">Nothing matches &quot;{query.trim()}&quot;</h2>
					<p className="text-sm text-muted-foreground">Try a shorter word, a type such as form, or the site name.</p>
					<Button type="button" variant="outline" className="mt-2" onClick={clearSearch}>
						<X aria-hidden />
						Clear search
					</Button>
				</div>
			) : (
				<div className="grid items-start gap-x-8 gap-y-10 lg:grid-cols-2">
					{visible.map((section) => (
						<section key={section.id} aria-labelledby={`links-${section.id}`} className="grid min-w-0 gap-3">
							<h2 id={`links-${section.id}`} className="text-xl font-semibold text-primary [overflow-wrap:anywhere]">
								{section.name}
							</h2>
							<ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60 bg-card">
								{section.links.map((link) => (
									<li key={link.id} className="flex min-w-0 items-stretch transition-colors has-[a:hover]:bg-secondary/35 has-[a:focus-visible]:bg-secondary/35">
										<a
											href={link.url}
											target="_blank"
											rel="noreferrer"
											className="group flex min-w-0 flex-1 items-start gap-3 py-3.5 pl-4 pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
										>
											<LinkKindTile kind={link.kind} />
											<span className="min-w-0 flex-1">
												<span className="block font-semibold leading-6 text-foreground [overflow-wrap:anywhere] group-hover:text-accent">
													{link.title}
													{link.isNew ? (
														<span className="ml-2 inline-block rounded-md bg-secondary px-2 py-0.5 align-middle text-xs font-medium leading-4 text-secondary-foreground">New</span>
													) : null}
												</span>
												{link.description ? (
													<span className="mt-0.5 block text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">{link.description}</span>
												) : null}
												<span className="mt-1 block text-xs leading-5 text-muted-foreground">
													{LINK_KIND_LABELS[link.kind]} <span aria-hidden>·</span> <span className="[overflow-wrap:anywhere]">{link.host}</span>
												</span>
											</span>
											<ArrowUpRight
												className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent motion-reduce:transition-none"
												aria-hidden
											/>
											<span className="sr-only">(opens in a new tab)</span>
										</a>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="mr-2 mt-2.5 size-9 shrink-0 text-muted-foreground hover:bg-secondary hover:text-accent"
											aria-label={`Copy link to ${link.title}`}
											title="Copy link"
											onClick={() => void copy(link)}
										>
											{copied?.id === link.id && copied.ok ? <Check aria-hidden /> : <Copy aria-hidden />}
										</Button>
									</li>
								))}
							</ul>
						</section>
					))}
				</div>
			)}
			<div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-24 z-50 flex justify-center lg:bottom-8">
				{copied ? (
					<p className="rounded-full bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20">
						{copied.ok ? "Link copied" : "Could not copy. Open the link and copy it from the address bar."}
					</p>
				) : null}
			</div>
		</div>
	);
}

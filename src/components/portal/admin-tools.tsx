"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Search, X } from "lucide-react";
import type { AdminGroup } from "@/app/portal/admin/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { adminGroupInfo } from "./admin-group-info";

export function AdminTools({ groups, showFilters = true }: { groups: AdminGroup[]; showFilters?: boolean }) {
	const [query, setQuery] = useState("");
	const [section, setSection] = useState("all");
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const matches = groups
		.filter((group) => section === "all" || group.segment === section)
		.map((group) => ({
			...group,
			pages: group.pages.filter((page) => words.every((word) => `${group.label} ${page.label} ${page.description}`.toLowerCase().includes(word))),
		}))
		.filter((group) => group.pages.length > 0);
	const count = matches.reduce((total, group) => total + group.pages.length, 0);

	return (
		<div className="grid gap-6">
			<div className="grid gap-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<label className="relative w-full sm:max-w-md">
						<span className="sr-only">Find an admin tool</span>
						<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
						<Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a tool, e.g. members or points" className="h-11 bg-card pl-10" />
					</label>
					<p className="text-sm text-muted-foreground" role="status">{count} {count === 1 ? "tool" : "tools"}{query.trim() ? " found" : " available"}</p>
				</div>
				{showFilters ? (
					<div className="flex flex-wrap gap-1 border-b border-border/60 pb-3" role="group" aria-label="Filter admin tools by section">
						{[{ segment: "all", label: "All tools" }, ...groups].map((group) => (
							<Button key={group.segment} type="button" variant={section === group.segment ? "default" : "ghost"} aria-pressed={section === group.segment} className="h-9 px-3" onClick={() => setSection(group.segment)}>{group.label}</Button>
						))}
					</div>
				) : null}
			</div>
			{matches.length ? (
				<div className={cn("grid items-start gap-x-8 gap-y-8", showFilters && "lg:grid-cols-2")}>
					{matches.map((group) => {
						const info = adminGroupInfo[group.segment as keyof typeof adminGroupInfo];
						const Icon = info?.icon;
						return (
							<section key={group.segment} aria-label={group.label} className="min-w-0">
								{showFilters ? (
									<div className="mb-3 flex items-start gap-3">
										{Icon ? <Icon className="mt-1 size-5 shrink-0 text-accent" aria-hidden /> : null}
										<div>
											<h2 className="text-xl font-semibold text-primary"><Link href={group.href} className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{group.label}</Link></h2>
											<p className="mt-0.5 text-sm leading-5 text-muted-foreground">{info?.description}</p>
										</div>
									</div>
								) : null}
								<ul className="divide-y divide-border/50 rounded-xl border border-border/60 bg-card">
									{group.pages.map((page) => (
										<li key={page.href}>
											<Link href={page.href} className="group flex items-center gap-4 rounded-lg px-4 py-3 transition-colors hover:bg-secondary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
												<div className="min-w-0 flex-1">
													<span className="font-semibold text-foreground group-hover:text-accent">{page.label}</span>
													<p className="mt-0.5 text-sm leading-5 text-muted-foreground">{page.description}</p>
												</div>
												<ArrowRight className="size-4 shrink-0 text-muted-foreground group-hover:text-accent" aria-hidden />
											</Link>
										</li>
									))}
								</ul>
							</section>
						);
					})}
				</div>
			) : (
				<div className="grid justify-items-start gap-2 py-8">
					<h2 className="text-xl font-semibold">No tools match your search</h2>
					<p className="text-sm text-muted-foreground">Try a task such as attendance, roles or email, or clear the filters.</p>
					<Button type="button" variant="outline" className="mt-2" onClick={() => { setQuery(""); setSection("all"); }}><X /> Clear filters</Button>
				</div>
			)}
		</div>
	);
}

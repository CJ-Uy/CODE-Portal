import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BackToLibrary } from "./back-to-library";

const TABS = [
	{ key: "browse", label: "Browse", href: "/portal/library" },
	{ key: "lists", label: "Lists", href: "/portal/library/lists" },
	{ key: "mine", label: "My items", href: "/portal/library/mine" },
	{ key: "about", label: "About", href: "/portal/library/about" },
] as const;

export type LibraryTab = (typeof TABS)[number]["key"];

/**
 * The top of every main library page. It stays the same on all four, and only the underlined tab moves, so a member
 * always knows they are in the library and how to reach the rest of it. The page's own content starts below it.
 */
export function LibraryHeader({ current }: { current: LibraryTab }) {
	return (
		<header className="grid min-w-0 gap-4">
			<div className="flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
				<div className="grid min-w-0 gap-1">
					{/* Focusable so the list's Back to top can return focus here. */}
					<h1 id="library-title" tabIndex={-1} className="font-heading text-3xl outline-none">
						Library
					</h1>
					<p className="max-w-[70ch] text-sm text-muted-foreground">Modules, frameworks and guides that CODErs wrote. Look here before you write your next one.</p>
				</div>
				<Button asChild className="min-h-11">
					<Link href="/portal/library/new">
						<Plus aria-hidden />
						Add to the library
					</Link>
				</Button>
			</div>
			<nav aria-label="Library" className="border-b border-border">
				<ul className="flex flex-wrap gap-x-1">
					{TABS.map((tab) => {
						const active = tab.key === current;
						return (
							<li key={tab.key}>
								<Link
									href={tab.href}
									aria-current={active ? "page" : undefined}
									className={cn(
										"-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
										// The `!` beats the unlayered `* { border-color }` in globals.css, which otherwise wins over every border-color utility.
										active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
									)}
								>
									{tab.label}
								</Link>
							</li>
						);
					})}
				</ul>
			</nav>
		</header>
	);
}

export type Crumb = { label: string; href?: string };

/**
 * Where a deeper library page sits: Library first, then each level, ending on the page itself (not a link).
 * The Library step returns to the list the member left, at the same row (see BackToLibrary). Labels are user text, so they wrap anywhere.
 */
export function LibraryCrumbs({ trail }: { trail: Crumb[] }) {
	return (
		<nav aria-label="Breadcrumb" className="min-w-0">
			<ol className="flex min-w-0 flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
				<li className="flex items-center">
					<BackToLibrary className="inline-flex min-h-11 items-center rounded-md px-1 font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
				</li>
				{trail.map((crumb, index) => {
					const last = index === trail.length - 1;
					return (
						<li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-x-1">
							<ChevronRight className="size-4 shrink-0" aria-hidden />
							{crumb.href && !last ? (
								<Link href={crumb.href} className="inline-flex min-h-11 min-w-0 items-center rounded-md px-1 [overflow-wrap:anywhere] hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
									{crumb.label}
								</Link>
							) : (
								<span aria-current={last ? "page" : undefined} className="line-clamp-1 min-w-0 px-1 [overflow-wrap:anywhere]">
									{crumb.label}
								</span>
							)}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}

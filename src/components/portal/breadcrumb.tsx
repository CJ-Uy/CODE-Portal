import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
	return (
		<nav aria-label="Breadcrumb" className="min-w-0 text-sm text-muted-foreground">
			<ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
			{items.map((item, i) => (
				<li key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
					{i > 0 ? <ChevronRight className="size-3.5 opacity-60" aria-hidden /> : null}
					{item.href ? (
						<Link href={item.href} className="rounded-sm py-1 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
							{item.label}
						</Link>
					) : (
						<span className="font-medium text-foreground" aria-current="page">
							{item.label}
						</span>
					)}
				</li>
			))}
			</ol>
		</nav>
	);
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type AdminTab = { href: string; label: string };

export function AdminTabs({ tabs }: { tabs: AdminTab[] }) {
	const pathname = usePathname();
	return (
		<nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Admin sections">
			{tabs.map((tab) => {
				// /portal/admin is active only on exact match; deeper tabs match by prefix.
				const active = tab.href === "/portal/admin" ? pathname === tab.href : pathname.startsWith(tab.href);
				return (
					<Link
						key={tab.href}
						href={tab.href}
						className={cn(
							"-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-[color,border-color,transform] active:scale-[0.98]",
							active
								? "border-accent text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						{tab.label}
					</Link>
				);
			})}
		</nav>
	);
}

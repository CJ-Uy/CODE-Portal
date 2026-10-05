import Link from "next/link";
import { ChevronDown, LayoutDashboard } from "lucide-react";
import { crumbFor } from "@/app/portal/admin/nav";
import { cn } from "@/lib/utils";
import { adminGroupInfo } from "./admin-group-info";
import type { AdminNavGroup } from "./portal-shell";

export function AdminNavigation({ groups, pathname, mobile = false, onNavigate }: {
	groups: AdminNavGroup[];
	pathname: string;
	mobile?: boolean;
	onNavigate?: () => void;
}) {
	const trail = crumbFor(pathname);
	const currentGroup = trail[1]?.label;
	const linkClass = (active: boolean) => cn(
		"flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
		mobile ? (active ? "bg-secondary font-semibold text-primary" : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground")
			: (active ? "bg-white/12 font-semibold text-primary-foreground" : "text-primary-foreground/75 hover:bg-white/5 hover:text-primary-foreground"),
	);

	return (
		<nav className="grid content-start gap-1" aria-label="Admin sections">
			<Link href="/portal/admin" aria-current={pathname === "/portal/admin" ? "page" : undefined} onClick={onNavigate} className={linkClass(pathname === "/portal/admin")}><LayoutDashboard className="size-4" aria-hidden />Overview</Link>
			{groups.map((group) => {
				const Icon = adminGroupInfo[group.segment as keyof typeof adminGroupInfo]?.icon;
				const current = currentGroup === group.label;
				return (
					<details key={`${group.segment}-${pathname}`} open={current} className="group/section">
						<summary className={cn(linkClass(current), "cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden")}>
							{Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
							<span className="flex-1">{group.label}</span>
							<ChevronDown className="size-3.5 shrink-0 transition-transform group-open/section:rotate-180 motion-reduce:transition-none" aria-hidden />
						</summary>
						<div className="ml-5 grid gap-0.5 border-l border-current/15 pl-2 pt-1">
							{!group.pages.some((page) => page.href === group.href) ? <Link href={group.href} onClick={onNavigate} aria-current={pathname === group.href ? "page" : undefined} className={linkClass(pathname === group.href)}>Section overview</Link> : null}
							{group.pages.map((page) => {
								const specificPage = group.pages.some((item) => item.href !== group.href && (pathname === item.href || pathname.startsWith(`${item.href}/`)));
								const active = pathname === page.href || (trail.some((crumb) => crumb.href === page.href) && (page.href !== group.href || !specificPage));
								return <Link key={page.href} href={page.href} aria-current={active ? "page" : undefined} onClick={onNavigate} className={linkClass(active)}>{page.label}</Link>;
							})}
						</div>
					</details>
				);
			})}
		</nav>
	);
}

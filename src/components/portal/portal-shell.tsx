"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createElement, useRef, useState, type PointerEvent } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Link2, LogOut, Menu, Plus, X } from "lucide-react";
import { MemberCodeCard } from "@/components/member-code-card";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Breadcrumb } from "./breadcrumb";
import { AdminNavigation } from "./admin-navigation";
import { MemberAvatar } from "./member-avatar";
import { adminNav, primaryNav, secondaryNav, visiblePrimaryNav, visibleSecondaryNav, visibleMobileNav, type NavItem } from "./nav-items";
import type { FeatureFlags } from "@/server/features";
import { navPinIconFor } from "./nav-pin-icons";
import { adminHeading, crumbFor } from "@/app/portal/admin/nav";

export type AdminNavGroup = { segment: string; label: string; href: string; pages: { href: string; label: string }[] };

export type PortalShellProps = {
	member: { displayName: string; initials: string; subtitle?: string };
	memberId: string;
	navPins: { id: string; label: string; url: string; icon: string }[];
	showAdmin: boolean;
	adminGroups: AdminNavGroup[];
	/** Release flags, resolved server-side. Plain booleans so they cross the client boundary. */
	flags: FeatureFlags;
	bell: React.ReactNode;
	signOutAction: () => Promise<void>;
	children: React.ReactNode;
};

function isActive(pathname: string, href: string): boolean {
	return href === "/portal" ? pathname === "/portal" : pathname.startsWith(href);
}

const detailTitles: Record<string, string> = {
	"/portal/calendar": "Event details",
	"/portal/library": "Library item",
	"/portal/links": "Link stats",
	"/portal/surveys": "Survey",
	"/portal/admin/content/surveys": "Survey details",
};

function getPageHeading(pathname: string): { section: string; title: string } {
	const cleanPath = pathname.split("?")[0] ?? "/portal";
	const navItems = [...primaryNav, ...secondaryNav, adminNav];
	const activeItem = navItems
		.filter((item) => isActive(cleanPath, item.href))
		.sort((a, b) => b.href.length - a.href.length)[0];

	if (cleanPath === "/portal") return { section: "Portal", title: "Overview" };
	if (cleanPath === "/portal/admin") return { section: "Admin", title: "Console" };

	if (cleanPath.startsWith("/portal/admin/")) {
		// dynamic detail pages (e.g. content/surveys/[id]) use the generic detail title.
		for (const [prefix, title] of Object.entries(detailTitles)) {
			if (cleanPath.startsWith(`${prefix}/`)) {
				const crumb = crumbFor(prefix);
				return { section: crumb.at(-1)?.label ?? "Admin", title };
			}
		}
		return adminHeading(cleanPath) ?? { section: "Admin", title: "Console" };
	}

	for (const [prefix, title] of Object.entries(detailTitles)) {
		if (cleanPath.startsWith(`${prefix}/`)) {
			return { section: activeItem?.label ?? "Portal", title };
		}
	}

	return { section: "Portal", title: activeItem?.label ?? "Overview" };
}

function RailItem({ item, pathname }: { item: NavItem; pathname: string }) {
	const Icon = item.icon;
	const on = isActive(pathname, item.href);
	return (
		<Link
			href={item.href}
			className={cn(
				"relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
				on ? "bg-white/10 text-primary-foreground" : "text-primary-foreground/65 hover:text-primary-foreground",
			)}
		>
			{on ? (
				<span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-secondary" aria-hidden />
			) : null}
			<Icon className="size-5" />
			<span className="flex-1">{item.label}</span>
			{item.id === "admin" ? (
				<span className="rounded-full bg-white/15 px-2 py-0.5 text-[0.6rem] font-bold tracking-wide text-accent-foreground">
					ADMIN
				</span>
			) : null}
		</Link>
	);
}

export function PortalShell({ member, memberId, navPins, showAdmin, adminGroups, flags, bell, signOutAction, children }: PortalShellProps) {
	const pathname = usePathname();
	const [menuOpen, setMenuOpen] = useState(false);
	const [drag, setDrag] = useState({ y: 0, active: false, touched: false });
	const dragStart = useRef<{ id: number; y: number } | null>(null);
	const dragged = useRef(false);

	function changeMenuOpen(next: boolean) {
		setMenuOpen(next);
		if (next) setDrag({ y: 0, active: false, touched: false });
	}

	function startDrag(event: PointerEvent<HTMLButtonElement>) {
		if (!event.isPrimary || event.button !== 0) return;
		dragStart.current = { id: event.pointerId, y: event.clientY };
		dragged.current = false;
		event.currentTarget.setPointerCapture(event.pointerId);
		setDrag({ y: 0, active: true, touched: true });
	}

	function moveDrag(event: PointerEvent<HTMLButtonElement>) {
		if (dragStart.current?.id !== event.pointerId) return;
		const distance = event.clientY - dragStart.current.y;
		if (Math.abs(distance) > 5) dragged.current = true;
		setDrag({ y: Math.max(0, distance), active: true, touched: true });
	}

	function finishDrag(event: PointerEvent<HTMLButtonElement>) {
		if (dragStart.current?.id !== event.pointerId) return;
		const dismiss = event.type === "pointerup" && event.clientY - dragStart.current.y >= 80;
		dragStart.current = null;
		setDrag((current) => ({ ...current, y: dismiss ? current.y : 0, active: false }));
		if (dismiss) changeMenuOpen(false);
	}
	const inAdmin = pathname === "/portal/admin" || pathname.startsWith("/portal/admin/");
	const pageHeading = getPageHeading(pathname);

	// Flagged-off destinations must not render a link. The pages themselves already 404,
	// but a visible link to a 404 reads as a broken portal rather than an unshipped one.
	const primary = visiblePrimaryNav(flags);
	const secondary = visibleSecondaryNav(flags);
	const mobile = visibleMobileNav(flags);
	const sheetItems: NavItem[] = [...primary, ...secondary].filter((item) => !mobile.some((tab) => tab.id === item.id));
	if (showAdmin) sheetItems.push(adminNav);
	const leftTabs = mobile.slice(0, 2);
	const rightTabs = mobile.slice(2, 4);

	return (
		<div className="min-h-screen bg-background text-foreground lg:flex">
			<a href="#portal-content" className="sr-only z-50 rounded-md bg-card px-4 py-3 text-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
			{/* Desktop sidebar rail */}
			<aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1 bg-primary px-4 py-6 text-primary-foreground lg:flex">
				<Link href="/portal" aria-label="Ateneo CODE home" className="mb-4 flex items-center gap-2.5 px-2">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src="/code-falcon-white.png" alt="" className="h-9 w-auto" />
					<span className="flex flex-col leading-none">
						<span className="text-[0.6rem] font-medium uppercase tracking-[0.24em] text-primary-foreground/70">
							Ateneo
						</span>
						<span className="font-heading text-xl font-bold leading-tight tracking-tight">CODE</span>
					</span>
				</Link>
				{inAdmin ? (
					<>
						<Link
							href="/portal"
							className="mb-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-primary-foreground/70 transition-colors hover:bg-white/5 hover:text-primary-foreground"
						>
							<ChevronLeft className="size-5" />
							Back to portal
						</Link>
						<Separator className="my-2 bg-white/10" />
						<div className="min-h-0 flex-1 overflow-y-auto pr-1"><AdminNavigation groups={adminGroups} pathname={pathname} /></div>
					</>
				) : (
					<div className="min-h-0 flex-1 overflow-y-auto pr-1">
						<nav className="flex flex-col gap-1" aria-label="Portal modules">
							{primary.map((item) => (
								<RailItem key={item.id} item={item} pathname={pathname} />
							))}
						</nav>
						{secondary.length || navPins.length ? <Separator className="my-3 bg-white/10" /> : null}
						<nav className="flex flex-col gap-1" aria-label="Resources and updates">
							{secondary.length ? <p className="px-3 pb-1 text-xs font-semibold text-primary-foreground/70">Resources &amp; updates</p> : null}
							{secondary.map((item) => (
								<RailItem key={item.id} item={item} pathname={pathname} />
							))}
							{navPins.length > 0 ? (
								<>
									<p className="px-3 pb-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-primary-foreground/45">
										Pinned links
									</p>
									{navPins.map((pin) => (
										<PinnedNavLink key={pin.id} pin={pin} />
									))}
								</>
							) : null}
						</nav>
					</div>
				)}
				<div className="mt-auto pt-2">
					{!inAdmin && showAdmin ? (
						<div className="pb-1">
							<RailItem item={adminNav} pathname={pathname} />
						</div>
					) : null}
					<Separator className="mb-2 bg-white/10" />
					<div className="flex items-center gap-2 rounded-xl p-2 transition-colors hover:bg-white/5">
						<MemberAvatar initials={member.initials} />
						<div className="min-w-0 flex-1 leading-tight">
							<p className="truncate text-sm font-semibold text-primary-foreground">{member.displayName}</p>
							{member.subtitle ? <p className="truncate text-xs text-primary-foreground/60">{member.subtitle}</p> : null}
						</div>
						<form action={signOutAction} className="shrink-0">
							<button
								type="submit"
								aria-label="Sign out"
								title="Sign out"
								className="grid size-8 place-items-center rounded-lg text-primary-foreground/60 transition-colors hover:bg-white/10 hover:text-primary-foreground"
							>
								<LogOut className="size-4" />
							</button>
						</form>
					</div>
				</div>
			</aside>

			<div className="flex min-h-screen w-full min-w-0 flex-col">
				{/* Top bar: navy app bar on mobile, light utility bar on desktop. */}
				<header className="sticky top-0 z-30 flex items-center justify-between gap-4 bg-primary px-4 py-3 text-primary-foreground sm:px-6 lg:border-b lg:border-border lg:bg-card lg:text-card-foreground lg:px-8">
					<Link href="/portal" aria-label="Ateneo CODE home" className="flex items-center gap-2 lg:hidden">
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img src="/code-falcon-white.png" alt="" className="h-8 w-auto" />
						<span className="flex flex-col leading-none">
							<span className="text-[0.55rem] font-medium uppercase tracking-[0.22em] text-primary-foreground/70">
								Ateneo
							</span>
							<span className="font-heading text-lg font-bold leading-tight tracking-tight">CODE</span>
						</span>
					</Link>
					<div className="hidden min-w-0 flex-1 lg:block">
						{inAdmin ? (
							<Breadcrumb items={[{ label: "Portal", href: "/portal" }, ...crumbFor(pathname)]} />
						) : (
							<>
								{pathname !== "/portal/ments" ? <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">{pageHeading.section}</p> : null}
								<p className="truncate font-heading text-xl font-semibold text-foreground">{pageHeading.title}</p>
							</>
						)}
					</div>
					<div className="flex items-center gap-2">
						{bell}
					</div>
				</header>
				{inAdmin ? <div className="border-b border-border/60 bg-card px-4 py-2 sm:px-6 lg:hidden"><Breadcrumb items={[{ label: "Portal", href: "/portal" }, ...crumbFor(pathname)]} /></div> : null}
				<main id="portal-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-28 outline-none sm:px-6 lg:px-8 lg:py-8 lg:pb-10">{children}</main>
			</div>

			{/* Mobile bottom nav with a raised center FAB that opens the "More" sheet. */}
			<Sheet open={menuOpen} onOpenChange={changeMenuOpen}>
				{inAdmin ? (
					<nav aria-label="Admin navigation" className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
						<Button asChild variant="ghost"><Link href="/portal"><ChevronLeft /> Portal</Link></Button>
						<Button asChild variant="ghost"><Link href="/portal/admin">Overview</Link></Button>
						<SheetTrigger asChild><Button type="button" aria-label="Open admin menu"><Menu /> Menu</Button></SheetTrigger>
					</nav>
				) : (
				<nav
					className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-primary text-primary-foreground lg:hidden"
					aria-label="Portal modules"
				>
					<div className="relative mx-auto flex h-16 max-w-md items-center justify-around px-1">
						{leftTabs.map((item) => (
							<BarTab key={item.id} item={item} pathname={pathname} />
						))}
						{/* spacer reserving room for the FAB */}
						<span className="w-16 shrink-0" aria-hidden />
						{rightTabs.map((item) => (
							<BarTab key={item.id} item={item} pathname={pathname} />
						))}

						<SheetTrigger asChild>
							<button
								type="button"
								aria-label="Open menu"
								aria-expanded={menuOpen}
								className={cn(
									"absolute -top-6 left-1/2 grid size-14 -translate-x-1/2 place-items-center rounded-full bg-secondary text-primary shadow-lg ring-4 ring-background transition-transform duration-200 active:scale-90",
									menuOpen && "rotate-45",
								)}
							>
								<Plus className="size-7" />
							</button>
						</SheetTrigger>
					</div>
				</nav>
				)}

				<SheetContent
					side="bottom"
					showCloseButton={false}
					className={cn("max-h-[82dvh] gap-0 overflow-hidden rounded-t-2xl", !drag.active && "motion-safe:transition-transform motion-safe:duration-180 motion-safe:ease-out")}
					style={{ transform: `translateY(${drag.y}px)`, animation: menuOpen && drag.touched ? "none" : undefined }}
				>
					<div className="relative shrink-0">
						<Button
							type="button"
							variant="ghost"
							aria-label="Close menu or drag down"
							className="h-11 w-full touch-none rounded-none hover:bg-transparent"
							onPointerDown={startDrag}
							onPointerMove={moveDrag}
							onPointerUp={finishDrag}
							onPointerCancel={finishDrag}
							onLostPointerCapture={finishDrag}
							onClick={(event) => { if (!event.detail || !dragged.current) changeMenuOpen(false); }}
						>
							<span className="h-1 w-10 rounded-full bg-muted-foreground/50" aria-hidden />
						</Button>
						<SheetTitle className="px-5 pb-4 pr-16 font-heading text-2xl">{inAdmin ? "Admin menu" : "Quick actions"}</SheetTitle>
						<SheetDescription className="sr-only">Drag the handle down to close. Choose an action or go to another page.</SheetDescription>
						<SheetClose asChild><Button type="button" variant="ghost" size="icon" className="absolute right-3 top-11 size-11" aria-label="Close menu"><X className="size-5" /></Button></SheetClose>
					</div>
					<div className="min-h-0 overflow-y-auto overscroll-contain pb-[max(1.5rem,env(safe-area-inset-bottom))]">

					{!inAdmin ? <>
					<div className="px-4 pb-3">
						<MemberCodeCard memberId={memberId} />
					</div>
					<div className="grid grid-cols-2 gap-2 px-4 pb-4">
						<SheetClose asChild>
							<Button asChild variant="secondary" className="h-14 gap-2 rounded-xl px-2"><Link href="/portal/calendar?create=1"><CalendarPlus className="size-5" />Create event</Link></Button>
						</SheetClose>
						<SheetClose asChild>
							<Button asChild variant="secondary" className="h-14 gap-2 rounded-xl px-2"><Link href="/portal/links?create=1"><Link2 className="size-5" />New short link</Link></Button>
						</SheetClose>
					</div>
					</> : null}

					<nav className="flex flex-col border-t border-border px-2 pt-3" aria-label="More modules">
						{!inAdmin ? <h3 className="px-3 pb-1 text-sm font-semibold text-muted-foreground">
							Go to
						</h3> : null}
						{inAdmin ? (
							<>
								<SheetClose asChild>
									<Link href="/portal" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold hover:bg-muted">
										<span className="grid size-9 place-items-center rounded-lg bg-secondary text-accent">
											<ChevronLeft className="size-5" />
										</span>
										<span className="flex-1">Back to portal</span>
									</Link>
								</SheetClose>
								<AdminNavigation groups={adminGroups} pathname={pathname} mobile onNavigate={() => changeMenuOpen(false)} />
							</>
						) : (
							<>
								{sheetItems.map((item) => {
									const Icon = item.icon;
									return (
										<SheetClose asChild key={item.id}>
											<Link
												href={item.href}
												className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold hover:bg-muted"
											>
												<span className="grid size-9 place-items-center rounded-lg bg-secondary text-accent">
													<Icon className="size-5" />
												</span>
												<span className="flex-1">{item.label}</span>
												<ChevronRight className="size-4 text-muted-foreground" />
											</Link>
										</SheetClose>
									);
								})}
								{navPins.length > 0 ? (
									<div className="mt-2 border-t border-border pt-2">
										<p className="px-3 pb-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
											Pinned links
										</p>
										{navPins.map((pin) => (
											<SheetClose asChild key={pin.id}>
												<a
													href={pin.url}
													target="_blank"
													rel="noreferrer"
													className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold hover:bg-muted"
												>
													<span className="grid size-9 place-items-center rounded-lg bg-secondary text-accent">
														<PinnedNavIcon name={pin.icon} className="size-5" />
													</span>
													<span className="flex-1 truncate">{pin.label}</span>
												</a>
											</SheetClose>
										))}
									</div>
								) : null}
							</>
						)}
					</nav>

					<div className="mt-2 border-t border-border px-2 pt-2">
						<form action={signOutAction}>
							<button
								type="submit"
								className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-destructive hover:bg-muted"
							>
								<span className="grid size-9 place-items-center rounded-lg bg-secondary">
									<LogOut className="size-5" />
								</span>
								Sign out
							</button>
						</form>
					</div>
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}

function PinnedNavIcon({ name, className }: { name: string; className?: string }) {
	return createElement(navPinIconFor(name), { className });
}

function PinnedNavLink({ pin }: { pin: { id: string; label: string; url: string; icon: string } }) {
	return (
		<a
			href={pin.url}
			target="_blank"
			rel="noreferrer"
			className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-primary-foreground/65 transition-colors hover:text-primary-foreground"
		>
			<PinnedNavIcon name={pin.icon} className="size-5" />
			<span className="flex-1 truncate">{pin.label}</span>
		</a>
	);
}

function BarTab({ item, pathname }: { item: NavItem; pathname: string }) {
	const Icon = item.icon;
	const on = isActive(pathname, item.href);
	return (
		<Link
			href={item.href}
			aria-current={on ? "page" : undefined}
			className={cn(
				"flex flex-1 flex-col items-center gap-1 py-2 text-[0.65rem] font-medium transition-colors",
				on ? "text-secondary" : "text-primary-foreground/55",
			)}
		>
			<Icon className="size-5" />
			{item.label}
		</Link>
	);
}

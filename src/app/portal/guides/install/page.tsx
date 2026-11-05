import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Bookmark, BookOpen, Menu, NotebookPen, FileText, Languages, ChevronDown, Clock, Copy, EllipsisVertical, Glasses, Lightbulb, Lock, Plus, RotateCw, Search, Share, SquarePlus, Star, X } from "lucide-react";
import { AUDIENCE_BADGE, GUIDE_ICONS } from "@/components/guides/guide-meta";
import { GuideNeighbours } from "@/components/guides/guide-neighbours";
import { Breadcrumb } from "@/components/portal/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { AUDIENCE_LABEL, GUIDES } from "@/lib/guides/content";
import { neighbours, visibleGuides } from "@/lib/guides/filter";
import { cn } from "@/lib/utils";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { signInPath } from "@/server/auth/sign-in";
import { isFeatureEnabled } from "@/server/features";
import { StandaloneRedirect } from "./standalone-redirect";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Install the app",
	description: "Add CODE Portal to your phone's home screen in under a minute.",
};

type Os = "android" | "ios";
type Step = { key: string; title: string; body: React.ReactNode; tip?: React.ReactNode; mock: React.ReactNode };

/**
 * The install guide, laid out like the other guides but with drawn phone screens instead of screenshots, and a
 * tab per platform. The tabs are plain links (?os=), so no client JS; with no choice yet, the user agent picks.
 * The launch email's step images are screenshots of these cards: re-render them after a change
 * (.local/app-launch-art/render.cjs).
 */
export default async function InstallGuidePage({ searchParams }: { searchParams: Promise<{ os?: string }> }) {
	const actor = await getActor();
	if (!actor) redirect(await signInPath());
	const { os: requested } = await searchParams;
	const ua = (await headers()).get("user-agent") ?? "";
	const os: Os = requested === "ios" || requested === "android" ? requested : /iPhone|iPad|iPod/i.test(ua) ? "ios" : "android";
	const steps = os === "ios" ? IOS_STEPS : ANDROID_STEPS;

	const visible = visibleGuides(GUIDES, {
		canAdmin: can(actor, "survey:configure"),
		surveys: isFeatureEnabled("surveys"),
		retention: isFeatureEnabled("retention"),
	});
	const guide = visible.find((item) => item.slug === "install");
	const { prev, next } = neighbours("install", visible);
	const Icon = GUIDE_ICONS.smartphone;

	return (
		<article className="mx-auto grid w-full min-w-0 max-w-3xl gap-8">
			<StandaloneRedirect />
			<div className="grid min-w-0 gap-5">
				<Breadcrumb items={[{ label: "Guides", href: "/portal/guides" }, { label: "Install the app" }]} />
				<InstallHero />
				<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
					<span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-accent">
						<Icon className="size-5" aria-hidden="true" />
					</span>
					<Badge variant={AUDIENCE_BADGE.member}>{AUDIENCE_LABEL.member}</Badge>
					<span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
						<Clock className="size-3.5" aria-hidden="true" />~{guide?.minutes ?? 1} min
					</span>
				</div>
				<p className="min-w-0 max-w-2xl text-muted-foreground">
					It opens full screen, one tap from your home screen, like any other app. No app store needed. Pick your phone:
				</p>
				<nav aria-label="Phone type" className="inline-flex w-fit rounded-full border border-border bg-card p-1">
					{(
						[
							["android", "Android"],
							["ios", "iPhone or iPad"],
						] as const
					).map(([id, label]) => (
						<Link
							key={id}
							href={`/portal/guides/install?os=${id}`}
							scroll={false}
							aria-current={os === id ? "page" : undefined}
							className={cn(
								"rounded-full px-5 py-2.5 text-sm font-semibold transition-colors",
								os === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
							)}
						>
							{label}
						</Link>
					))}
				</nav>
			</div>

			{os === "ios" ? (
				<Tip>
					<strong>On any iOS version:</strong> Safari’s menus move around between updates. Whatever yours looks like, find <strong>Share</strong>, then scroll down to <strong>Add to Home Screen</strong>.
				</Tip>
			) : null}

			<ol className="grid min-w-0 border-t border-border/60 pt-8">
				{steps.map((step, index) => {
					const last = index === steps.length - 1;
					return (
						<li key={step.key} data-step className={`relative grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-x-3 sm:gap-x-5 ${last ? "" : "pb-10"}`}>
							{last ? null : <span aria-hidden="true" className="absolute bottom-0 left-4 top-10 w-px -translate-x-1/2 bg-border" />}
							<span aria-hidden="true" className="grid size-8 place-items-center rounded-full border border-border bg-card font-heading text-sm font-semibold text-primary">
								{index + 1}
							</span>
							<div className="grid min-w-0 gap-4">
								<div className="grid min-w-0 gap-1.5 pt-0.5">
									<h2 className="font-heading text-xl leading-snug [overflow-wrap:anywhere] sm:text-2xl">
										<span className="sr-only">Step {index + 1}: </span>
										{step.title}
									</h2>
									<p className="text-muted-foreground [overflow-wrap:anywhere]">{step.body}</p>
								</div>
								<div aria-hidden data-mock className="h-52 w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
									{step.mock}
								</div>
								{step.tip ? <Tip>{step.tip}</Tip> : null}
							</div>
						</li>
					);
				})}
			</ol>

			<section aria-labelledby="good-to-know" className="grid gap-3 border-t border-border/60 pt-8">
				<h2 id="good-to-know" className="font-heading text-2xl">
					Good to know
				</h2>
				{GOOD_TO_KNOW.map((tip) => (
					<Tip key={tip.key}>{tip.text}</Tip>
				))}
			</section>

			<GuideNeighbours prev={prev} next={next} />
		</article>
	);
}

function Tip({ children }: { children: React.ReactNode }) {
	return (
		<p className="flex min-w-0 items-start gap-2.5 rounded-lg border border-border/60 bg-secondary/50 p-3 text-sm text-secondary-foreground">
			<Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
			<span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
		</p>
	);
}

const GOOD_TO_KNOW = [
	{
		key: "updates",
		text: (
			<>
				<strong>It updates itself.</strong> No need to delete and add it again when updates arrive. If it was left open in the background, close it and open it again.
			</>
		),
	},
	{ key: "inapp", text: "Opened the link from Messenger, Facebook or Gmail? Open it in Chrome (Android) or Safari (iPhone) first. In-app browsers can't add apps." },
	{ key: "same", text: "It's the same portal as the website: same account, same calendar, same check-in code." },
	{ key: "desktop", text: "On a computer, click the install icon at the right end of the address bar in Chrome or Edge." },
];

/* ---------- hero ---------- */

/** Same art as the launch email's hero image, so the email and the guide read as one piece. */
function InstallHero() {
	return (
		<section className="relative isolate grid min-h-[22rem] overflow-hidden rounded-3xl bg-[radial-gradient(120%_90%_at_85%_15%,#1b4a78_0%,#06192f_55%)] text-white sm:grid-cols-[minmax(0,1fr)_15rem]">
			<div className="grid content-center gap-4 px-6 pb-4 pt-10 sm:px-10 sm:py-12">
				<span className="w-fit rounded-full bg-[#d7dfe9] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[#06192f]">New</span>
				<h1 className="max-w-md font-heading text-4xl leading-[1.04] text-balance sm:text-5xl">Add CODE Portal as an app on your phone.</h1>
			</div>
			<div aria-hidden className="relative h-64 sm:h-auto">
				<div className="absolute left-1/2 top-4 h-[21rem] w-48 -translate-x-1/2 rotate-[4deg] rounded-[2.1rem] border-[6px] border-[#1d3a5c] bg-[#0b223d] px-4 pt-10 shadow-[0_30px_60px_rgba(0,0,0,0.45)] sm:top-12">
					<span className="absolute left-1/2 top-2.5 h-4 w-16 -translate-x-1/2 rounded-full bg-[#020b16]" />
					<div className="grid grid-cols-3 gap-x-3 gap-y-4">
						{Array.from({ length: 12 }, (_, i) =>
							i === 4 ? (
								<span key={i} className="grid justify-items-center gap-1">
									<Image src="/icons/icon-192.png" alt="" width={46} height={46} className="size-11 rounded-xl shadow-[0_0_0_3px_#fff,0_0_28px_8px_rgba(144,180,204,0.65)]" />
									<span className="text-[10px] font-bold">CODE</span>
								</span>
							) : (
								<span key={i} className="size-10 justify-self-center rounded-[0.7rem] bg-white/12" />
							),
						)}
					</div>
				</div>
			</div>
			<i aria-hidden className="absolute left-[56%] top-8 size-2 rotate-[20deg] rounded-sm bg-[#90B4CC]" />
			<i aria-hidden className="absolute right-6 top-14 h-2.5 w-1.5 -rotate-[30deg] rounded-sm bg-[#d7dfe9]" />
			<i aria-hidden className="absolute right-12 top-6 size-1.5 rounded-full bg-white" />
		</section>
	);
}

/* ---------- mock UI ---------- */

const ring = "ring-2 ring-[#4986AC] ring-offset-2 ring-offset-card";
const darkRing = "ring-2 ring-[#90B4CC] ring-offset-2 ring-offset-[#3a3a3c]";

function UrlBar({ menuHighlight = false }: { menuHighlight?: boolean }) {
	return (
		<div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
			<div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-secondary/70 px-3 py-1.5 text-xs text-muted-foreground">
				<Lock className="size-3" />
				ateneocode.org
			</div>
			<span className={cn("grid size-7 place-items-center rounded-full text-muted-foreground", menuHighlight && ring)}>
				<EllipsisVertical className="size-4" />
			</span>
		</div>
	);
}

function PageLines() {
	return (
		<div className="grid gap-2 p-4">
			<div className="h-3.5 w-2/3 rounded-full bg-secondary" />
			<div className="h-2 w-full rounded-full bg-secondary/70" />
			<div className="h-2 w-5/6 rounded-full bg-secondary/70" />
			<div className="h-2 w-3/5 rounded-full bg-secondary/70" />
		</div>
	);
}

function AppRow({ dark = false }: { dark?: boolean }) {
	return (
		<div className="flex min-w-0 items-center gap-3">
			<Image src="/icons/icon-192.png" alt="" width={36} height={36} className="size-9 shrink-0 rounded-lg" />
			<div className="grid min-w-0 text-left leading-tight">
				<span className="truncate text-sm font-semibold">CODE</span>
				<span className={cn("truncate text-xs", dark ? "text-white/55" : "text-muted-foreground")}>ateneocode.org/portal</span>
			</div>
		</div>
	);
}

const ANDROID_STEPS: Step[] = [
	{
		key: "a1",
		title: "Open Chrome's menu",
		body: "In Chrome, open the portal and tap the three-dot menu at the top right.",
		mock: (
			<>
				<UrlBar menuHighlight />
				<PageLines />
			</>
		),
	},
	{
		key: "a2",
		title: "Tap Install app",
		body: "Some phones call it Add to Home screen.",
		tip: "If Chrome asks you to choose between Install and Create shortcut, pick Install. A shortcut only opens the website, not the app.",
		mock: (
			<div className="relative h-full">
				<UrlBar />
				<PageLines />
				<div className="absolute right-3 top-11 grid w-40 gap-0.5 rounded-xl border border-border bg-card p-1.5 text-xs shadow-lg">
					<span className="px-2 py-1.5">New tab</span>
					<span className="px-2 py-1.5">Bookmarks</span>
					<span className={cn("flex items-center gap-1.5 rounded-md px-2 py-1.5 font-semibold", ring)}>
						<Plus className="size-3.5" />
						Install app
					</span>
					<span className="px-2 py-1.5">Share…</span>
				</div>
			</div>
		),
	},
	{
		key: "a3",
		title: "Tap Install",
		body: "The navy CODE icon lands on your home screen.",
		mock: (
			<div className="grid h-full place-items-center bg-primary/60 p-4">
				<div className="grid w-full max-w-60 gap-3 rounded-2xl bg-card p-4 shadow-lg">
					<p className="text-sm font-semibold">Install app</p>
					<AppRow />
					<div className="flex justify-end gap-3 text-xs font-semibold">
						<span className="px-2 py-1.5 text-[#4986AC]">Cancel</span>
						<span className={cn("rounded-full bg-[#1a56c4] px-3 py-1.5 text-white", ring)}>Install</span>
					</div>
				</div>
			</div>
		),
	},
];

/** iOS 26 Safari, drawn from real screenshots: a floating toolbar, a ••• menu, then the share sheet. */
/** iOS 27 Safari: the page menu sits behind the ≡ icon at the left end of the address bar; the right-hand circle is Tabs. */
function SafariToolbar() {
	return (
		<div className="flex items-center gap-2 px-3 pb-3">
			<span className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-card text-lg leading-none shadow-sm">‹</span>
			<span className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-3 text-xs shadow-sm">
				<span className={cn("grid size-6 shrink-0 place-items-center rounded-full", ring)}>
					<Menu className="size-3.5" />
				</span>
				<span className="min-w-0 flex-1 truncate">ateneocode.org</span>
				<RotateCw className="size-3 shrink-0" />
			</span>
			<span className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-card shadow-sm">
				<Copy className="size-3.5" />
			</span>
		</div>
	);
}

function DarkSheet({ children, className }: { children: React.ReactNode; className?: string }) {
	return <div className={cn("grid gap-1 rounded-2xl bg-[#3a3a3c] p-2 text-xs text-white shadow-lg", className)}>{children}</div>;
}

function SheetRow({ icon: Icon, label, active = false }: { icon: typeof Share; label: string; active?: boolean }) {
	return (
		<span className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5", active && cn("bg-white/10 font-semibold", darkRing))}>
			<Icon className="size-3.5 shrink-0" />
			{label}
		</span>
	);
}

const IOS_STEPS: Step[] = [
	{
		key: "i1",
		title: "Open Safari’s menu",
		body: "In Safari, open the portal. On iOS 27, tap the ≡ icon at the left end of the address bar. On iOS 26, it’s the ••• button at the bottom right.",
		tip: "See Share right in Safari’s toolbar instead? That’s Safari’s Bottom or Top tab layout, or an iPad. Tap it and skip to step 3.",
		mock: (
			<div className="grid h-full grid-rows-[1fr_auto]">
				<PageLines />
				<SafariToolbar />
			</div>
		),
	},
	{
		key: "i2",
		title: "Tap Share",
		body: "Find it in the menu. On iOS 27 it sits under Show Reader and Translate.",
		mock: (
			<div className="grid h-full content-end justify-items-end bg-secondary/40 p-3">
				<DarkSheet className="w-44">
					<SheetRow icon={FileText} label="Show Reader" />
					<SheetRow icon={Languages} label="Translate" />
					<SheetRow icon={Share} label="Share" active />
					<SheetRow icon={Bookmark} label="Add to Bookmarks" />
				</DarkSheet>
			</div>
		),
	},
	{
		key: "i3",
		title: "Tap View More",
		body: "It’s the last button in the bottom row of the share sheet.",
		mock: (
			<div className="grid h-full content-end bg-secondary/40 px-2 pt-3">
				<div className="grid gap-3 rounded-t-2xl bg-[#3a3a3c] p-3 text-white">
					<AppRow dark />
					<div className="grid grid-cols-4 gap-1 text-center text-[10px] leading-tight">
						{[
							[Copy, "Copy"],
							[Bookmark, "Add to Bookmarks"],
							[Glasses, "Add to Reading List"],
						].map(([Icon, label]) => {
							const I = Icon as typeof Copy;
							return (
								<span key={label as string} className="grid justify-items-center gap-1">
									<span className="grid size-9 place-items-center rounded-full bg-white/15">
										<I className="size-4" />
									</span>
									{label as string}
								</span>
							);
						})}
						<span className="grid justify-items-center gap-1 font-semibold">
							<span className={cn("grid size-9 place-items-center rounded-full bg-white/15", darkRing)}>
								<ChevronDown className="size-4" />
							</span>
							View More
						</span>
					</div>
				</div>
			</div>
		),
	},
	{
		key: "i4",
		title: "Tap Add to Home Screen",
		body: "Scroll down the list to find it.",
		mock: (
			<div className="grid h-full content-center bg-secondary/40 p-3">
				<DarkSheet>
					<SheetRow icon={BookOpen} label="Add Bookmark to…" />
					<SheetRow icon={Star} label="Add to Favorites" />
					<SheetRow icon={NotebookPen} label="Add to Quick Note" />
					<SheetRow icon={Search} label="Find on Page" />
					<SheetRow icon={SquarePlus} label="Add to Home Screen" active />
				</DarkSheet>
			</div>
		),
	},
	{
		key: "i5",
		title: "Tap Add",
		body: "Keep Open as Web App switched on. The navy CODE icon lands on your home screen.",
		mock: (
			<div className="grid h-full content-start gap-3 bg-[#1c1c1e] p-3 text-white">
				<div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-xs">
					<span className="grid size-7 place-items-center rounded-full border border-white/25">
						<X className="size-3.5" />
					</span>
					<span className="truncate text-center font-semibold">Add to Home Screen</span>
					<span className={cn("rounded-full bg-[#7ab3ff] px-3 py-1 font-semibold text-[#06192f]", "ring-2 ring-[#90B4CC] ring-offset-2 ring-offset-[#1c1c1e]")}>Add</span>
				</div>
				<div className="rounded-xl bg-[#2c2c2e] p-2.5">
					<AppRow dark />
				</div>
				<div className="flex items-center justify-between rounded-xl bg-[#2c2c2e] px-3 py-2 text-xs">
					Open as Web App
					<span className="flex h-5 w-9 items-center justify-end rounded-full bg-[#34c759] p-0.5">
						<span className="size-4 rounded-full bg-white" />
					</span>
				</div>
			</div>
		),
	},
];

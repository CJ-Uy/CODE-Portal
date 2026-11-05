import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowRight, Check, EllipsisVertical, Lock, Plus, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StandaloneRedirect } from "./standalone-redirect";

export const metadata: Metadata = {
	title: "Install the app",
	description: "Put CODE Portal on your phone's home screen in under a minute.",
};

type Os = "android" | "ios";

/**
 * Public on purpose: the launch email links here, and a member should be able to install before signing in.
 * The tabs are plain links (?os=), so the page needs no client JS; with no choice yet, the phone's user agent picks.
 */
export default async function InstallPage({ searchParams }: { searchParams: Promise<{ os?: string }> }) {
	const { os: requested } = await searchParams;
	const ua = (await headers()).get("user-agent") ?? "";
	const os: Os = requested === "ios" || requested === "android" ? requested : /iPhone|iPad|iPod|Macintosh.*Mobile/i.test(ua) ? "ios" : "android";
	const steps = os === "ios" ? IOS_STEPS : ANDROID_STEPS;

	return (
		<div className="min-h-screen bg-background text-foreground">
			<StandaloneRedirect />
			<header className="border-b border-border/60 bg-card">
				<div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
					<Link href="/portal" className="flex items-center gap-2">
						<Image src="/code-falcon-transparent.png" alt="" width={29} height={32} className="h-8 w-auto" />
						<span className="flex flex-col leading-none">
							<span className="text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">Ateneo</span>
							<span className="font-heading text-lg font-bold text-primary">CODE</span>
						</span>
					</Link>
					<Button asChild variant="outline" size="sm">
						<Link href="/portal">Open the portal</Link>
					</Button>
				</div>
			</header>

			<main className="mx-auto grid max-w-5xl gap-14 px-4 py-10 sm:px-6 sm:py-16">
				<section className="grid items-center gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
					<div className="grid min-w-0 gap-4">
						<p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">New</p>
						<h1 className="font-heading text-4xl leading-[1.05] text-balance text-primary sm:text-6xl">CODE Portal is now an app.</h1>
						<p className="max-w-md text-lg text-muted-foreground">
							Put it on your home screen in under a minute. Then open it with one tap, full screen, like any other app. No app store needed.
						</p>
					</div>
					<HomeScreen />
				</section>

				<section aria-labelledby="how" className="grid gap-6 border-t border-border/60 pt-10">
					<div className="grid gap-2">
						<h2 id="how" className="font-heading text-3xl text-primary">
							How to install
						</h2>
						<p className="text-muted-foreground">Pick your phone. It takes three taps.</p>
					</div>

					<nav aria-label="Phone type" className="inline-flex w-fit rounded-full border border-border bg-card p-1">
						{(
							[
								["android", "Android"],
								["ios", "iPhone or iPad"],
							] as const
						).map(([id, label]) => (
							<Link
								key={id}
								href={`/install?os=${id}`}
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

					<ol className="grid gap-6 sm:grid-cols-3">
						{steps.map((step, index) => (
							<li key={step.text} className="grid content-start gap-4">
								<div aria-hidden className="h-44 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
									{step.mock}
								</div>
								<p className="flex gap-3 text-[0.9375rem] leading-relaxed">
									<span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
										{index + 1}
									</span>
									<span className="pt-0.5">{step.text}</span>
								</p>
							</li>
						))}
					</ol>
				</section>

				<section aria-labelledby="good-to-know" className="grid gap-4 border-t border-border/60 pt-10">
					<h2 id="good-to-know" className="font-heading text-3xl text-primary">
						Good to know
					</h2>
					<ul className="grid gap-3 sm:grid-cols-2">
						{GOOD_TO_KNOW.map((tip) => (
							<li key={tip} className="flex gap-3 rounded-xl border border-border bg-card p-4 text-[0.9375rem] leading-relaxed">
								<Check className="mt-1 size-4 shrink-0 text-accent" aria-hidden />
								<span>{tip}</span>
							</li>
						))}
					</ul>
				</section>

				<section className="grid justify-items-start gap-4 rounded-2xl bg-primary px-6 py-8 text-primary-foreground sm:px-10">
					<h2 className="font-heading text-3xl">Already installed?</h2>
					<p className="max-w-md text-primary-foreground/75">Open CODE from your home screen. It always loads the newest version, so there&apos;s nothing to update.</p>
					<Button asChild variant="secondary" className="bg-white text-primary hover:bg-white/90">
						<Link href="/portal">
							Open CODE Portal <ArrowRight />
						</Link>
					</Button>
				</section>
			</main>
		</div>
	);
}

const GOOD_TO_KNOW = [
	"Opened the link from Messenger, Facebook or Gmail? Open it in Chrome (Android) or Safari (iPhone) first. In-app browsers can't install apps.",
	"The app updates itself. If it was left open in the background, close it and open it again to get the latest.",
	"It's the same portal as the website: same account, same calendar, same check-in code.",
	"On a computer, click the install icon at the right end of the address bar in Chrome or Edge.",
];

/* ---------- mock UI ---------- */

const ring = "ring-2 ring-[#4986AC] ring-offset-2 ring-offset-card";

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

function AppRow() {
	return (
		<div className="flex items-center gap-3">
			<Image src="/icons/icon-192.png" alt="" width={36} height={36} className="size-9 rounded-lg" />
			<div className="grid text-left leading-tight">
				<span className="text-sm font-semibold">CODE</span>
				<span className="text-xs text-muted-foreground">ateneocode.org</span>
			</div>
		</div>
	);
}

function Dialog({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="grid h-full place-items-center bg-primary/60 p-4">
			<div className="grid w-full max-w-60 gap-3 rounded-2xl bg-card p-4 shadow-lg">
				<p className="text-sm font-semibold">{title}</p>
				{children}
			</div>
		</div>
	);
}

const ANDROID_STEPS: { text: string; mock: React.ReactNode }[] = [
	{
		text: "In Chrome, open the portal and tap the three-dot menu at the top right.",
		mock: (
			<>
				<UrlBar menuHighlight />
				<PageLines />
			</>
		),
	},
	{
		text: "Tap Install app. Some phones call it Add to Home screen.",
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
		text: "Tap Install. The navy CODE icon lands on your home screen.",
		mock: (
			<Dialog title="Install app">
				<AppRow />
				<div className="flex justify-end gap-3 text-xs font-semibold">
					<span className="px-2 py-1.5 text-[#4986AC]">Cancel</span>
					<span className={cn("rounded-full bg-[#1a56c4] px-3 py-1.5 text-white", ring)}>Install</span>
				</div>
			</Dialog>
		),
	},
];

const IOS_STEPS: { text: string; mock: React.ReactNode }[] = [
	{
		text: "In Safari, open the portal and tap Share. On iPhone it's at the bottom; on iPad, at the top.",
		mock: (
			<div className="grid h-full grid-rows-[1fr_auto]">
				<PageLines />
				<div className="grid gap-2 border-t border-border/60 bg-secondary/30 px-3 pb-3 pt-2">
					<div className="flex items-center justify-center gap-1.5 rounded-xl bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
						<Lock className="size-3" />
						ateneocode.org
					</div>
					<div className="flex items-center justify-around text-[#1a73e8]">
						<span className="text-lg leading-none">‹</span>
						<span className="text-lg leading-none opacity-40">›</span>
						<span className={cn("grid size-7 place-items-center rounded-md", ring)}>
							<Share className="size-4" />
						</span>
						<span className="text-xs">▢</span>
					</div>
				</div>
			</div>
		),
	},
	{
		text: "Scroll down the list and tap Add to Home Screen.",
		mock: (
			<div className="grid h-full content-end bg-primary/60 px-3">
				<div className="grid gap-0.5 rounded-t-2xl bg-card p-2 text-xs shadow-lg">
					<span className="px-2 py-1.5">Copy</span>
					<span className="px-2 py-1.5">Add Bookmark</span>
					<span className={cn("flex items-center justify-between rounded-md px-2 py-1.5 font-semibold", ring)}>
						Add to Home Screen
						<Plus className="size-3.5 rounded-sm border border-current" />
					</span>
					<span className="px-2 py-1.5">Find on Page</span>
				</div>
			</div>
		),
	},
	{
		text: "Tap Add at the top right. The navy CODE icon lands on your home screen.",
		mock: (
			<div className="grid h-full content-start gap-4 bg-secondary/30 p-3">
				<div className="flex items-center justify-between text-xs font-semibold text-[#1a73e8]">
					<span className="font-normal">Cancel</span>
					<span className="text-foreground">Add to Home Screen</span>
					<span className={cn("rounded-md px-1.5 py-0.5", ring)}>Add</span>
				</div>
				<div className="rounded-xl bg-card p-3">
					<AppRow />
				</div>
			</div>
		),
	},
];

/** The hero's home screen: blank tiles around the CODE icon, so the icon is the only thing to look at. */
function HomeScreen() {
	return (
		<div aria-hidden className="grid grid-cols-3 gap-5 rounded-[2rem] bg-secondary/60 p-8">
			{Array.from({ length: 9 }, (_, i) =>
				i === 4 ? (
					<div key={i} className="grid justify-items-center gap-1.5">
						<Image src="/icons/icon-192.png" alt="" width={64} height={64} className="size-16 rounded-2xl shadow-lg ring-4 ring-white" />
						<span className="text-xs font-semibold text-primary">CODE</span>
					</div>
				) : (
					<div key={i} className="size-16 justify-self-center rounded-2xl bg-white/70" />
				),
			)}
		</div>
	);
}

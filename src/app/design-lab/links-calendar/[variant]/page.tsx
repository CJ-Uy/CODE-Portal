import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, Copy, Download, Link2, Plus, QrCode, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Links and calendar design study" };

const links = [
	{ title: "CODE membership form", short: "ateneocode.org/go/join", destination: "forms.ateneo.edu/code-membership", clicks: 128, owner: "You" },
	{ title: "Orientation guide", short: "ateneocode.org/go/orientation", destination: "drive.google.com/orientation-guide", clicks: 42, owner: "You" },
	{ title: "Event feedback", short: "ateneocode.org/go/feedback", destination: "forms.ateneo.edu/event-feedback", clicks: 9, owner: "CODE" },
];

const sections = [
	{ title: "Today", hint: "Monday, September 28", events: [
		{ day: "28", month: "SEP", time: "4:00 PM", title: "CRS planning session", place: "CODE Room", kind: "Official", role: "Managing" },
	] },
	{ title: "Upcoming", hint: "Next on your calendar", events: [
		{ day: "30", month: "SEP", time: "2:00 PM", title: "Community coffee", place: "Faura Hall", kind: "Casual", role: "Going" },
		{ day: "04", month: "OCT", time: "9:00 AM", title: "Resource workshop", place: "Online", kind: "Official", role: "Open" },
	] },
	{ title: "Past", hint: "Most recent first", events: [
		{ day: "24", month: "SEP", time: "1:00 PM", title: "September forum", place: "CODE Room", kind: "Official", role: "Attended" },
	] },
];

function ActionButtons({ compact = false }: { compact?: boolean }) {
	return (
		<div className={compact ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-2"}>
			<Button variant="outline" size="sm" type="button"><Copy /> Copy</Button>
			<Button variant="outline" size="sm" type="button"><QrCode /> QR</Button>
		</div>
	);
}

function LinksPreview({ variant }: { variant: "a" | "b" }) {
	return (
		<section id="links" aria-labelledby="links-heading" className="space-y-5">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Member links</p>
					<h2 id="links-heading" className="text-3xl text-primary">Short links</h2>
					<p className="mt-1 text-sm text-muted-foreground">Share and track official CODE links.</p>
				</div>
				<Button type="button"><Plus /> Create link</Button>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground sm:max-w-sm"><Search className="size-4 shrink-0" /> Search links</div>
				<Badge variant="secondary">All links</Badge>
				<span className="text-sm text-muted-foreground">3 links</span>
			</div>
			{variant === "a" ? (
				<>
					<div className="hidden overflow-hidden rounded-lg border bg-card md:block">
						<table className="w-full text-left text-sm">
							<thead className="border-b bg-secondary/50 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Link</th><th className="px-4 py-3">Destination</th><th className="px-4 py-3 text-right">Clicks</th><th className="px-4 py-3">Actions</th></tr></thead>
							<tbody>{links.map((item) => <tr key={item.short} className="border-b last:border-b-0"><td className="px-4 py-4"><strong className="block font-semibold text-foreground">{item.title}</strong><span className="text-primary">{item.short}</span></td><td className="max-w-52 truncate px-4 py-4 text-muted-foreground">{item.destination}</td><td className="px-4 py-4 text-right tabular-nums">{item.clicks}</td><td className="px-4 py-4"><ActionButtons compact /></td></tr>)}</tbody>
						</table>
					</div>
					<div className="space-y-2 md:hidden">{links.map((item) => <article key={item.short} className="rounded-lg border bg-card p-4"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="font-semibold">{item.title}</h3><p className="break-all text-sm font-semibold text-primary">{item.short}</p></div><span className="shrink-0 text-xs text-muted-foreground">{item.clicks} clicks</span></div><p className="mt-2 truncate text-xs text-muted-foreground">To {item.destination}</p><div className="mt-3"><ActionButtons compact /></div></article>)}</div>
				</>
			) : (
				<div className="overflow-hidden rounded-lg border bg-card">{links.map((item) => <article key={item.short} className="border-b p-4 last:border-b-0"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="break-all font-semibold text-primary">{item.short}</p><p className="mt-0.5 text-sm text-foreground">{item.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">To {item.destination}</p></div><div className="text-right"><strong className="block tabular-nums">{item.clicks}</strong><span className="text-xs text-muted-foreground">clicks</span></div></div><div className="mt-3 flex items-center justify-between gap-2 border-t pt-3"><span className="text-xs text-muted-foreground">{item.owner}</span><ActionButtons compact /></div></article>)}</div>
			)}
			<div className="rounded-lg border bg-card p-4 sm:p-5">
				<div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected link</p><h3 className="mt-1 break-all text-xl text-primary">ateneocode.org/go/join</h3><p className="mt-1 text-sm text-muted-foreground">CODE membership form</p></div><Button variant="outline" size="sm" type="button"><Copy /> Copy link</Button></div>
				<div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2"><div><p className="text-sm font-semibold">QR code</p><p className="mt-1 text-xs text-muted-foreground">Ready to download for print or digital sharing.</p><Button variant="outline" size="sm" className="mt-3" type="button"><Download /> Download QR</Button><details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-primary">Customize QR</summary><p className="mt-2 text-muted-foreground">Pattern, corners, logo, and colors appear here.</p></details></div><div><p className="text-sm font-semibold">Link activity</p><p className="mt-1 text-2xl font-semibold tabular-nums">128 <span className="text-sm font-normal text-muted-foreground">lifetime clicks</span></p><p className="mt-2 text-xs text-muted-foreground">No clicks in the selected 30 days. Try a longer date range to see earlier activity.</p></div></div>
			</div>
		</section>
	);
}

function CalendarPreview({ variant }: { variant: "a" | "b" }) {
	return (
		<section id="calendar" aria-labelledby="calendar-heading" className="space-y-5">
			<div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Shared calendar</p><h2 id="calendar-heading" className="text-3xl text-primary">Events</h2><p className="mt-1 text-sm text-muted-foreground">Find what is next, then revisit what happened.</p></div><Button variant="outline" type="button"><CalendarDays /> Month view</Button></div>
			<div className="flex gap-2 border-b pb-2 text-sm"><span className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground">List</span><span className="px-3 py-1.5 text-muted-foreground">Calendar</span></div>
			<div className="space-y-6">{sections.map((section) => <div key={section.title}>
				<div className="mb-2 flex flex-wrap items-baseline gap-x-3"><h3 className="text-2xl text-primary">{section.title}</h3><span className="text-sm text-muted-foreground">{section.hint}</span></div>
				<div className={variant === "a" ? "space-y-2" : "overflow-hidden rounded-lg border bg-card"}>{section.events.map((event) => <article key={event.title} className={variant === "a" ? "flex items-start gap-3 rounded-lg border bg-card p-4" : "flex items-start gap-3 border-b p-4 last:border-b-0"}>
					<div className={variant === "a" ? "flex w-12 shrink-0 flex-col items-center rounded-md bg-secondary/65 py-1 text-primary" : "flex w-12 shrink-0 flex-col items-center border-r pr-3 text-primary"}><span className="text-[10px] font-bold tracking-widest">{event.month}</span><span className="text-xl font-semibold leading-none tabular-nums">{event.day}</span></div>
					<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><h4 className="text-lg leading-5 text-foreground">{event.title}</h4><Badge variant="secondary">{event.role}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{event.time} · {event.place}</p><p className="mt-1 text-xs text-muted-foreground">{event.kind} event</p></div><ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				</article>)}</div>
			</div>)}</div>
		</section>
	);
}

export function generateStaticParams() { return [{ variant: "a" }, { variant: "b" }]; }

export default async function PrototypePage({ params }: { params: Promise<{ variant: string }> }) {
	const { variant: routeVariant } = await params;
	const variant = routeVariant === "b" ? "b" : "a";
	return (
		<main className="min-h-screen bg-background px-4 py-7 sm:px-8 sm:py-10">
			<div className="mx-auto max-w-6xl space-y-12">
				<header className="space-y-5 border-b pb-6"><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-bold tracking-wide text-primary"><Link2 className="size-4" /> CODE design lab</span><span className="text-xs text-muted-foreground">Fake data · visual study only</span></div><div><h1 className="text-4xl text-primary">Links and calendar</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Two low-fidelity layouts for the approved member experience. Compare the link list, detail, and event list at desktop and mobile sizes.</p></div><nav aria-label="Prototype variants" className="flex gap-2"><Button variant={variant === "a" ? "default" : "outline"} size="sm" asChild><Link href="/design-lab/links-calendar/a">A · Balanced</Link></Button><Button variant={variant === "b" ? "default" : "outline"} size="sm" asChild><Link href="/design-lab/links-calendar/b">B · Compact</Link></Button></nav><div className="flex gap-4 text-sm"><a className="text-primary underline underline-offset-4" href="#links">Links</a><a className="text-primary underline underline-offset-4" href="#calendar">Calendar</a></div></header>
				<LinksPreview variant={variant} />
				<CalendarPreview variant={variant} />
				<footer className="border-t pt-5 text-xs text-muted-foreground">Prototype {variant.toUpperCase()} · No account or event data is connected.</footer>
			</div>
		</main>
	);
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/server/auth/sign-in";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { READINESS_LABELS } from "@/lib/library/taxonomy";
import type { LibraryPublicReadiness } from "@/lib/library/taxonomy";
import { getActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";

// DRAFT COPY for CJ to edit. Written from the spec (sections 1 and 7.1); nothing here is a final word.

const LABEL_MEANINGS: { value: LibraryPublicReadiness; meaning: string }[] = [
	{
		value: "not_eligible",
		meaning: "Books, papers and outside websites start here. They belong to someone else, so we don't plan to share them publicly.",
	},
	{
		value: "needs_adapting",
		meaning: "Good material that isn't ready yet. It may name a client, lean on context only CODE has, or need a rewrite for a reader who wasn't in the room.",
	},
	{
		value: "public_ready",
		meaning: "A moderator has marked it as something that could be shared with other student organizations as it is.",
	},
];

const WHY_NOT_BUSINESS: { title: string; body: string }[] = [
	{ title: "Members are volunteers.", body: "Nobody is paid to show up, so motivation, commitment and burnout work differently than they do on a payroll." },
	{ title: "The team changes every year.", body: "Officers graduate. What a team figured out leaves with them unless somebody wrote it down." },
	{ title: "The academic calendar sets the pace.", body: "Exams, breaks and the start of the term decide what a good plan looks like, not a fiscal quarter." },
	{ title: "Budgets are small.", body: "\"Hire a consultant\" or \"buy a tool\" isn't an answer when the budget is whatever the org raised this term." },
];

export default async function LibraryAboutPage() {
	if (!isFeatureEnabled("library")) notFound();
	const actor = await getActor();
	if (!actor) redirect(await signInPath());

	return (
		<article className="mx-auto grid min-w-0 max-w-2xl gap-8">
			<div className="grid gap-3">
				<Link href="/portal/library" className="inline-flex min-h-10 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
					<ArrowLeft className="size-4" aria-hidden />
					Library
				</Link>
				<div>
					<p className="text-xs font-semibold uppercase text-primary">About the library</p>
					<h1 className="font-heading text-3xl">Toward a public library</h1>
				</div>
				<p className="leading-7 text-muted-foreground">
					CODE has spent years doing organization-development work with student organizations: working out what is stuck, then designing the modules and sessions that help. Most of what we learned sits in Intervention Design Forms (IDFs) and modules that one batch of CODErs wrote for one engagement. This library keeps that work where the next batch can find it.
				</p>
			</div>

			<section aria-labelledby="why-title" className="grid gap-3">
				<h2 id="why-title" className="font-heading text-xl">
					Why advice written for businesses often misses
				</h2>
				<p className="leading-7 text-muted-foreground">
					Search for help running an organization and you will mostly find advice for companies. A lot of it is good, and a lot of it doesn&apos;t fit a youth org, because:
				</p>
				<ul className="grid gap-3">
					{WHY_NOT_BUSINESS.map((point) => (
						<li key={point.title} className="min-w-0 leading-7">
							<span className="font-medium">{point.title}</span> <span className="text-muted-foreground">{point.body}</span>
						</li>
					))}
				</ul>
			</section>

			<section aria-labelledby="hope-title" className="grid gap-3">
				<h2 id="hope-title" className="font-heading text-xl">
					What we hope it becomes
				</h2>
				<p className="leading-7 text-muted-foreground">
					We would like this to grow into a reliable resource that any student organization can use: practical, written by people who have done the work, and honest about what fits a volunteer team. We are not there yet. For now it is a place for us to collect what we have, check it, and make it better.
				</p>
			</section>

			<section aria-labelledby="labels-title" className="grid gap-3">
				<h2 id="labels-title" className="font-heading text-xl">
					What the public-readiness labels mean
				</h2>
				<p className="leading-7 text-muted-foreground">
					Moderators can mark an item to say whether it could one day be shared outside CODE. The label shows on its card. It is a note for later, and it changes nothing about who can see the item today.
				</p>
				<dl className="grid gap-3">
					{LABEL_MEANINGS.map(({ value, meaning }) => (
						<div key={value} className="min-w-0 rounded-xl border border-border p-4">
							<dt className="font-medium">{READINESS_LABELS[value]}</dt>
							<dd className="mt-1 text-sm leading-6 text-muted-foreground">{meaning}</dd>
						</div>
					))}
					<div className="min-w-0 rounded-xl border border-dashed border-border p-4">
						<dt className="font-medium">No label</dt>
						<dd className="mt-1 text-sm leading-6 text-muted-foreground">Nobody has reviewed it yet. Most items start here.</dd>
					</div>
				</dl>
			</section>

			<section aria-labelledby="members-title" className="grid gap-3">
				<h2 id="members-title" className="font-heading text-xl">
					Members only, for now
				</h2>
				<p className="leading-7 text-muted-foreground">
					Published items are visible to every signed-in CODE member and no one else. Drafts and items waiting for approval stay with their owners and the library moderators, and confidential items are limited further.
				</p>
				<p className="leading-7 text-muted-foreground">If you wrote something that helped a team, adding it is the best way to move this forward.</p>
				<div className="flex flex-wrap gap-2">
					<Button asChild className="min-h-10">
						<Link href="/portal/library/new">Add to the library</Link>
					</Button>
					<Button asChild variant="outline" className="min-h-10">
						<Link href="/portal/library">Back to the library</Link>
					</Button>
				</div>
			</section>
		</article>
	);
}

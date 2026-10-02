import Link from "next/link";
import { notFound } from "next/navigation";
import { describeTokenCategory } from "@/db/repositories/email-member";
import { emailConfigFromEnv, emailDbFromEnv } from "@/server/email/db";
import { verifyUnsubscribeToken } from "@/server/email/unsubscribe-token";
import { isFeatureEnabled } from "@/server/features";
import { UnsubscribeCard } from "./unsubscribe-card";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
	if (!isFeatureEnabled("email")) notFound();
	const raw = (await searchParams).t;
	const t = typeof raw === "string" ? raw : "";
	const payload = t ? await verifyUnsubscribeToken(emailConfigFromEnv().unsubscribeSecret, t) : null;
	const info = payload ? await describeTokenCategory(emailDbFromEnv(), payload) : null;
	return (
		<main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
			{info ? (
				<UnsubscribeCard token={t} categoryName={info.categoryName} requiredNames={info.requiredNames} initiallyOut={info.optedOut} />
			) : (
				<div className="grid w-full max-w-[420px] gap-3 rounded-2xl border border-border bg-card p-6">
					<h1 className="font-heading text-2xl">This link is not valid.</h1>
					<p className="text-sm text-muted-foreground">It may be old, or the email category no longer allows turning it off.</p>
					<Link href="/portal/mail/preferences" className="text-sm text-accent underline-offset-2 hover:underline">
						Sign in to manage email preferences
					</Link>
				</div>
			)}
		</main>
	);
}

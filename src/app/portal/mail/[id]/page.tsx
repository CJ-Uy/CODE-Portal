import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getRepositories } from "@/db";
import { EmailPreview } from "@/components/email/email-preview";
import { requireActor } from "@/server/auth/actor";
import { emailConfigFromEnv } from "@/server/email/db";

export const dynamic = "force-dynamic";
const DATE = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

export default async function MailReaderPage({ params }: { params: Promise<{ id: string }> }) {
	const actor = await requireActor();
	const { id } = await params;
	const { email } = await getRepositories();
	const view = await email.member.getForReader(actor, id, emailConfigFromEnv().publicBaseUrl);
	if (!view) notFound();
	return (
		<article className="mx-auto grid w-full max-w-[720px] gap-4">
			<Link href="/portal/mail" className="inline-flex items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground">
				<ArrowLeft className="size-4" aria-hidden />
				Mail
			</Link>
			<header className="grid gap-1">
				<h1 className="min-w-0 break-all font-heading text-3xl">{view.subject}</h1>
				<p className="text-sm text-muted-foreground">
					{view.senderName ?? "CODE"} · {view.sentAt ? DATE.format(view.sentAt) : ""}
				</p>
			</header>
			<EmailPreview bodyHtml={view.bodyHtml} />
			<p className="text-sm text-muted-foreground">
				Sent to you because: {view.categoryName}.{" "}
				<Link href="/portal/mail/preferences" className="text-accent underline-offset-2 hover:underline">
					Manage
				</Link>
			</p>
		</article>
	);
}

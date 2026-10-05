import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { PreferencesList } from "./preferences-list";

export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
	const actor = await requireActor();
	const { email } = await getRepositories();
	const rows = await email.member.listPreferences(actor);
	return (
		<div className="mx-auto grid w-full max-w-2xl gap-5">
			<Link href="/portal/mail" className="inline-flex items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground">
				<ArrowLeft className="size-4" aria-hidden />
				Mail
			</Link>
			<header>
				<h1 className="font-heading text-3xl">Email preferences</h1>
				<p className="text-sm text-muted-foreground">Choose which CODE emails reach your inbox. Changes save as you go.</p>
			</header>
			<PreferencesList rows={rows} />
		</div>
	);
}

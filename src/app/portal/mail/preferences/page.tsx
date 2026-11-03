import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { PageHeader } from "@/components/portal/page-header";
import { PreferencesList } from "./preferences-list";

export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
	const actor = await requireActor();
	const { email } = await getRepositories();
	const rows = await email.member.listPreferences(actor);
	return (
		<div className="grid w-full max-w-2xl gap-5">
			<Link href="/portal/mail" className="-my-2 inline-flex min-h-11 items-center gap-1 justify-self-start rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
				<ArrowLeft className="size-4" aria-hidden />
				Mail
			</Link>
			<PageHeader title="Email preferences" description="Choose which CODE emails reach your inbox. Changes save as you go." />
			<PreferencesList rows={rows} />
		</div>
	);
}

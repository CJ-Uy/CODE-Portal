import { getRepositories } from "@/db";
import { EMPTY_AUDIENCE } from "@/lib/email/types";
import { requireActor } from "@/server/auth/actor";
import { Composer } from "../composer";
import { loadComposerData } from "../composer-data";

export const dynamic = "force-dynamic";

export default async function NewEmailPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
	const actor = await requireActor();
	const { template: templateId } = await searchParams;
	const { email } = await getRepositories();
	const template = templateId ? await email.templates.get(actor, templateId) : null;
	const data = await loadComposerData(actor, null);
	return (
		<Composer
			{...data}
			initial={{
				id: null,
				templateId: template?.id ?? null,
				categoryId: template?.categoryId ?? null,
				senderId: null,
				subject: template?.subject ?? "",
				preheader: template?.preheader ?? "",
				blocks: template?.blocks ?? [],
				audience: EMPTY_AUDIENCE,
				status: "draft",
			}}
		/>
	);
}

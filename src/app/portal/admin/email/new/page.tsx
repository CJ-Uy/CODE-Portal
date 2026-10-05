import { getRepositories } from "@/db";
import { EMPTY_AUDIENCE } from "@/lib/email/types";
import { emailStarters } from "@/lib/email/starters";
import { requireActor } from "@/server/auth/actor";
import { Composer } from "../composer";
import { loadComposerData } from "../composer-data";

export const dynamic = "force-dynamic";

export default async function NewEmailPage({ searchParams }: { searchParams: Promise<{ template?: string; starter?: string }> }) {
	const actor = await requireActor();
	const { template: templateId, starter: starterId } = await searchParams;
	const { email } = await getRepositories();
	const template = templateId ? await email.templates.get(actor, templateId) : null;
	const data = await loadComposerData(actor, null);
	const starter = emailStarters(data.baseUrl).find((t) => t.id === starterId);
	const content = template ?? starter;
	return (
		<Composer
			{...data}
			initial={{
				id: null,
				templateId: template?.id ?? null,
				categoryId: template?.categoryId ?? null,
				senderId: null,
				subject: content?.subject ?? "",
				preheader: content?.preheader ?? "",
				blocks: content?.blocks ?? [],
				audience: EMPTY_AUDIENCE,
				mergeOverrides: {},
				status: "draft",
					scheduledAt: null,
			}}
		/>
	);
}

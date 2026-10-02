import { notFound, redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { Composer } from "../../../composer";
import { loadComposerData } from "../../../composer-data";

export const dynamic = "force-dynamic";

export default async function EditEmailPage({ params }: { params: Promise<{ id: string }> }) {
	const actor = await requireActor();
	const { id } = await params;
	const { email } = await getRepositories();
	const campaign = await email.campaigns.get(actor, id);
	if (!campaign) notFound();
	if (campaign.status !== "draft" && campaign.status !== "scheduled") redirect(`/portal/admin/email/sends/${id}`);
	const data = await loadComposerData(actor, campaign.audience);
	return (
		<Composer
			{...data}
			initial={{
				id: campaign.id,
				templateId: campaign.templateId,
				categoryId: campaign.categoryId,
				senderId: campaign.senderId,
				subject: campaign.subject,
				preheader: campaign.preheader,
				blocks: campaign.blocks,
				audience: campaign.audience,
				status: campaign.status,
			}}
		/>
	);
}

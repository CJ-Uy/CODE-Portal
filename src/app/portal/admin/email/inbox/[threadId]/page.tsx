import { notFound } from "next/navigation";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { InboxView } from "../inbox-view";
import { parseInboxParams } from "../params";

export const dynamic = "force-dynamic";

export default async function ThreadPage({
	params,
	searchParams,
}: {
	params: Promise<{ threadId: string }>;
	searchParams: Promise<{ folder?: string | string[]; filter?: string | string[] }>;
}) {
	const actor = await requireActor();
	const { threadId } = await params;
	const { folder, filter } = parseInboxParams(await searchParams);
	const { email } = await getRepositories();
	const view = await email.inbox.get(actor, threadId);
	if (!view) notFound();
	const [threads, assignees] = await Promise.all([email.inbox.list(actor, { folder, filter }), email.inbox.listAssignees(actor)]);
	return <InboxView folder={folder} filter={filter} threads={threads} view={view} assignees={assignees} />;
}

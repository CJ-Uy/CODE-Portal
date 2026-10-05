import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { InboxView } from "./inbox-view";
import { parseInboxParams } from "./params";

export const dynamic = "force-dynamic";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ folder?: string | string[]; filter?: string | string[] }> }) {
	const actor = await requireActor();
	const { folder, filter } = parseInboxParams(await searchParams);
	const { email } = await getRepositories();
	const [threads, assignees] = await Promise.all([email.inbox.list(actor, { folder, filter }), email.inbox.listAssignees(actor)]);
	return <InboxView folder={folder} filter={filter} threads={threads} view={null} assignees={assignees} />;
}

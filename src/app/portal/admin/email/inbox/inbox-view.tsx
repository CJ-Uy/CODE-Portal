import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import type { ThreadListItem, ThreadView } from "@/db/repositories/email-inbox";
import { cn } from "@/lib/utils";
import { formatManila } from "../campaign-row";
import { MessageBody, ReplyBox, ThreadControls } from "./thread-controls";

type Folder = "open" | "done";
type Filter = "all" | "mine" | "unassigned";

export function InboxView({
	folder,
	filter,
	threads,
	view,
	assignees,
}: {
	folder: Folder;
	filter: Filter;
	threads: ThreadListItem[];
	view: ThreadView | null;
	assignees: { id: string; name: string }[];
}) {
	const query = `?folder=${folder}&filter=${filter}`;
	const listHref = `/portal/admin/email/inbox${query}`;

	return (
		<div className="grid gap-4">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="font-heading text-3xl">Replies</h1>
					<p className="text-sm text-muted-foreground">Replies to CODE emails land here. Members see your answer from the same sender.</p>
				</div>
			</header>
			<div className="grid min-h-[60dvh] overflow-hidden rounded-xl border border-border bg-card md:grid-cols-[340px_minmax(0,1fr)]">
				<div className={cn("grid content-start border-border md:border-r", view && "max-md:hidden")}>
					<div className="flex flex-wrap gap-1 border-b border-border p-2">
						{(["open", "done"] as const).map((f) => (
							<Link key={f} href={`/portal/admin/email/inbox?folder=${f}&filter=${filter}`} aria-current={folder === f ? "page" : undefined} className="rounded-md px-2.5 py-1 text-sm capitalize transition-colors aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground hover:bg-secondary">
								{f}
							</Link>
						))}
						<span className="mx-1 w-px bg-border" aria-hidden />
						{(["all", "mine", "unassigned"] as const).map((f) => (
							<Link key={f} href={`/portal/admin/email/inbox?folder=${folder}&filter=${f}`} aria-current={filter === f ? "page" : undefined} className="rounded-md px-2.5 py-1 text-sm capitalize transition-colors aria-[current=page]:bg-secondary aria-[current=page]:font-medium hover:bg-secondary">
								{f}
							</Link>
						))}
					</div>
					{threads.length === 0 ? (
						<div className="grid place-items-center gap-2 p-10 text-center text-sm text-muted-foreground">
							<Mail className="size-6" aria-hidden />
							{folder === "open" ? "No open replies. You're caught up." : "Nothing marked done yet."}
						</div>
					) : (
						<ul className="grid divide-y divide-border">
							{threads.map((t, i) => (
								<li key={t.id} className="row-enter" style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}>
									<Link
										href={`/portal/admin/email/inbox/${t.id}${query}`}
										aria-current={view?.thread.id === t.id ? "page" : undefined}
										className="grid gap-0.5 px-4 py-3 transition-colors hover:bg-secondary/60 aria-[current=page]:bg-secondary"
									>
										<span className="flex min-w-0 items-center gap-2">
											{t.unread ? <span className="size-2 shrink-0 rounded-full bg-[#4986AC]" aria-label="Unread" /> : null}
											<span className={cn("min-w-0 flex-1 truncate", t.unread ? "font-semibold" : "font-medium")}>{t.memberName ?? t.fromName ?? t.fromEmail}</span>
											<span className="shrink-0 text-xs text-muted-foreground">{formatManila(t.lastMessageAt)}</span>
										</span>
										<span className="min-w-0 truncate text-sm">{t.subject}</span>
										<span className="flex min-w-0 gap-2 text-xs text-muted-foreground">
											{t.campaignSubject ? <span className="min-w-0 truncate rounded bg-secondary px-1.5">Re: {t.campaignSubject}</span> : null}
											{t.isAuto ? <span className="shrink-0">Auto-reply</span> : null}
											{t.assigneeName ? <span className="shrink-0">· {t.assigneeName}</span> : null}
										</span>
									</Link>
								</li>
							))}
						</ul>
					)}
				</div>

				<div className={cn("grid content-start gap-4 p-4", !view && "max-md:hidden")}>
					{view ? (
						<>
							<Link href={listHref} className="inline-flex items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground md:hidden">
								<ArrowLeft className="size-4" aria-hidden />
								Replies
							</Link>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="grid min-w-0 gap-1">
									<h2 className="min-w-0 break-all font-heading text-2xl">{view.thread.subject}</h2>
									<p className="min-w-0 break-all text-sm text-muted-foreground">
										{view.thread.memberName ? `${view.thread.memberName} · ` : ""}
										{view.thread.fromEmail}
										{view.thread.memberName ? "" : " · not a member"}
									</p>
									{view.thread.campaignId ? (
										<Link href={`/portal/admin/email/sends/${view.thread.campaignId}`} className="min-w-0 justify-self-start break-all rounded bg-secondary px-2 py-0.5 text-xs transition-colors hover:bg-secondary/70">
											Re: {view.thread.campaignSubject}
										</Link>
									) : null}
								</div>
								<ThreadControls threadId={view.thread.id} status={view.thread.status} assigneeId={view.thread.assigneeId} assignees={assignees} backHref={listHref} />
							</div>
							<ol className="grid gap-3">
								{view.messages.map((m) => (
									<li key={m.id} className={cn("row-enter grid gap-2 rounded-xl border p-4", m.direction === "out" ? "border-[#90B4CC] bg-secondary/40 md:ml-10" : "border-border")}>
										<div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
											<span className="min-w-0 break-all">{m.direction === "out" ? `You replied as ${m.fromEmail}` : m.fromEmail}</span>
											<span>{formatManila(m.createdAt)}</span>
										</div>
										<MessageBody text={m.text} html={m.direction === "in" ? m.html : null} />
									</li>
								))}
							</ol>
							<ReplyBox threadId={view.thread.id} to={view.thread.fromEmail} />
						</>
					) : (
						<div className="grid h-full place-items-center p-10 text-sm text-muted-foreground">Select a reply to read it.</div>
					)}
				</div>
			</div>
		</div>
	);
}

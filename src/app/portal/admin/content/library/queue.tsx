"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { approveItemAction, closeReportAction, dismissReportAction, restoreItemAction, restoreListFromQueueAction, sendBackItemAction, takeDownReportAction } from "./actions";
import { ReasonForm } from "./reason-form";
import type { ItemRow, ListRow, ReportRow } from "./rows";
import { RowError, useRun } from "./use-run";

/** Every control here is checked again on the server; the row only decides what is worth offering. */

const card = "grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4";

function Reason({ text }: { text: string | null }) {
	return text ? (
		<p className="min-w-0 rounded-md bg-secondary/60 px-3 py-2 text-sm [overflow-wrap:anywhere]">
			<span className="font-medium">Reason:</span> {text}
		</p>
	) : null;
}

function ItemSummary({ item, date }: { item: ItemRow; date: string }) {
	return (
		<div className="grid min-w-0 gap-1">
			<div className="flex min-w-0 flex-wrap items-center gap-2">
				<Link href={`/portal/library/${item.id}`} className="min-w-0 [overflow-wrap:anywhere] font-medium hover:underline">
					{item.title}
				</Link>
				{item.clientData ? <Badge variant="warn">Includes client data</Badge> : null}
			</div>
			<p className="min-w-0 [overflow-wrap:anywhere] text-sm text-muted-foreground">{item.meta}</p>
			<p className="text-xs text-muted-foreground">
				{date} {item.when}
			</p>
		</div>
	);
}

export function PendingItemRow({ item }: { item: ItemRow }) {
	const { pending, error, run } = useRun();
	const [asking, setAsking] = useState(false);
	return (
		<li className={card}>
			<ItemSummary item={item} date="Submitted" />
			<div className="flex flex-wrap gap-2">
				<Button type="button" disabled={pending} onClick={() => run(() => approveItemAction({ itemId: item.id }), "Approved. It is live.")}>
					Approve
				</Button>
				<Button type="button" variant={asking ? "default" : "outline"} disabled={pending} onClick={() => setAsking(!asking)}>
					Send back
				</Button>
			</div>
			{asking ? (
				<ReasonForm
					label="Why? The owner will read this."
					confirmLabel="Confirm: send back"
					pending={pending}
					onCancel={() => setAsking(false)}
					onConfirm={(reason) => run(() => sendBackItemAction({ itemId: item.id, reason }), "Sent back to its owner.", () => setAsking(false))}
				/>
			) : null}
			<RowError message={error} />
		</li>
	);
}

export function ReportCard({ report }: { report: ReportRow }) {
	const { pending, error, run } = useRun();
	const [asking, setAsking] = useState(false);
	return (
		<li className={card}>
			<div className="grid min-w-0 gap-1">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<Badge variant="secondary">{report.targetKind}</Badge>
					<Badge variant="outline">{report.reason}</Badge>
				</div>
				<Link href={report.href} className="min-w-0 [overflow-wrap:anywhere] font-medium hover:underline">
					{report.targetTitle}
				</Link>
				{report.details ? <p className="min-w-0 text-sm [overflow-wrap:anywhere]">{report.details}</p> : null}
				<p className="text-xs text-muted-foreground">Reported {report.when}</p>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={pending}
					onClick={() => run(() => dismissReportAction({ reportId: report.id }), report.live ? "Report dismissed. It stays up." : "Report dismissed.")}
				>
					Dismiss
				</Button>
				{report.live ? (
					<Button type="button" variant={asking ? "default" : "outline"} disabled={pending} onClick={() => setAsking(!asking)}>
						Take down
					</Button>
				) : (
					// Already out of view: nothing to take down, so nothing to explain to the owner.
					<Button type="button" disabled={pending} onClick={() => run(() => closeReportAction({ reportId: report.id }), "Report closed.")}>
						Close report
					</Button>
				)}
			</div>
			{!report.live ? <p className="text-sm text-muted-foreground">This {report.targetKind.toLowerCase()} is already out of view, so there is nothing left to take down.</p> : null}
			{report.live && asking ? (
				<ReasonForm
					label="Why? The owner will read this."
					confirmLabel="Confirm: take down"
					pending={pending}
					onCancel={() => setAsking(false)}
					onConfirm={(reason) => run(() => takeDownReportAction({ reportId: report.id, reason }), "Taken down. The report is closed.", () => setAsking(false))}
				/>
			) : null}
			<RowError message={error} />
		</li>
	);
}

export function TakenDownItemRow({ item }: { item: ItemRow }) {
	const { pending, error, run } = useRun();
	return (
		<li className={card}>
			<ItemSummary item={item} date="Last changed" />
			<Reason text={item.reason} />
			<div>
				<Button type="button" disabled={pending} onClick={() => run(() => restoreItemAction({ itemId: item.id }), "Restored. It is live again.")}>
					{pending ? "Restoring..." : "Restore"}
				</Button>
			</div>
			<RowError message={error} />
		</li>
	);
}

export function TakenDownListRow({ list }: { list: ListRow }) {
	const { pending, error, run } = useRun();
	return (
		<li className={card}>
			<div className="grid min-w-0 gap-1">
				<Link href={`/portal/library/lists/${list.id}`} className="min-w-0 [overflow-wrap:anywhere] font-medium hover:underline">
					{list.name}
				</Link>
				<p className="text-xs text-muted-foreground">Taken down {list.when}</p>
			</div>
			<Reason text={list.reason} />
			<div className="flex flex-wrap items-center gap-3">
				<Button type="button" disabled={pending} onClick={() => run(() => restoreListFromQueueAction({ listId: list.id }), "Restored. Its owner can share it again.")}>
					{pending ? "Restoring..." : "Restore"}
				</Button>
				<p className="min-w-0 text-sm text-muted-foreground">It stays unshared until its owner shares it again.</p>
			</div>
			<RowError message={error} />
		</li>
	);
}

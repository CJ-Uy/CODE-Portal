import { MessageSquareText } from "lucide-react";
import { PENDING_HATCH } from "@/components/retention-parts";
import type { EventFeedbackShare } from "@/db/repositories/retention";
import { formatPoints } from "@/lib/points";

const pendingList = (share: EventFeedbackShare) => share.pending.map((row) => `+${formatPoints(row.points)} ${row.pointTypeLabel}`).join(", ");

/**
 * The 75/25 split, said where members meet it. On an event page it explains the split to everyone; on the form it
 * names the viewer's own points still waiting on their answer.
 */
export function FeedbackShareNote({ share, on }: { share: EventFeedbackShare | null; on: "event" | "form" }) {
	if (!share?.hasForm || (on === "form" && share.pending.length === 0)) return null;
	return (
		<div className="flex min-w-0 items-start gap-3 rounded-lg border border-ring/60 bg-secondary/50 p-3 text-sm">
			<span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md" style={PENDING_HATCH} aria-hidden>
				<MessageSquareText className="size-4 rounded-sm bg-card text-accent" />
			</span>
			<div className="grid min-w-0 gap-0.5">
				{on === "event" ? (
					<>
						<p className="font-medium">This event has a feedback form.</p>
						<p className="text-muted-foreground">You get 75% of its points when you check in, and the other 25% when you answer the form.</p>
						{share.pending.length > 0 ? (
							<p className="font-medium [overflow-wrap:anywhere]">Waiting on your answer: {pendingList(share)}</p>
						) : null}
					</>
				) : (
					<>
						<p className="font-medium [overflow-wrap:anywhere]">Answering gives you the other 25% of this event&apos;s points: {pendingList(share)}.</p>
						<p className="text-muted-foreground">They count toward retention as soon as you send. If the form closes first, they are gone.</p>
					</>
				)}
			</div>
		</div>
	);
}

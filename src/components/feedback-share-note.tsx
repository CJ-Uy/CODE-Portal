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
	// One line, said once: what this event's form is worth to the viewer right now.
	const text =
		on === "form"
			? `Answering adds ${pendingList(share)}, the last 25% of this event's points.`
			: share.pending.length > 0
				? `Answer the feedback form to get your last ${pendingList(share)}.`
				: "This event has a feedback form: 75% of the points at check-in, 25% when you answer.";
	return (
		<p className="flex min-w-0 items-center gap-2.5 rounded-lg border border-ring/60 bg-secondary/50 px-3 py-2.5 text-sm">
			<span className="grid size-6 shrink-0 place-items-center rounded-md" style={PENDING_HATCH} aria-hidden>
				<MessageSquareText className="size-3.5 rounded-sm bg-card text-accent" />
			</span>
			<span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
		</p>
	);
}

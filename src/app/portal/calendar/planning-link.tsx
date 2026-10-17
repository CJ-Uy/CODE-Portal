import { planningLink } from "@/lib/feedback/archive-view";
import { cn } from "@/lib/utils";

/**
 * The "look back before you plan" link, shared by the create sheet and the edit form so the two
 * cannot drift. Opens in a new tab because both forms hold an unsaved draft; the hidden text
 * tells a screen reader so.
 */
export function PlanningLink({ type, label, className }: { type: string; label: string; className?: string }) {
	const link = planningLink(type, label);
	return (
		<p className={cn("min-w-0 text-xs [overflow-wrap:anywhere]", className)}>
			<a href={link.href} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
				{link.text}
				<span className="sr-only"> (opens in a new tab)</span>
			</a>
		</p>
	);
}

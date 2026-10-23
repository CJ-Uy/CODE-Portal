import { toLocalDate } from "@/lib/date-slots";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The small month-and-day block that leads an event row, in Manila time. `today` fills it light blue. */
export function DateTile({ date, today = false }: { date: Date; today?: boolean }) {
	const [, month, day] = toLocalDate(date).split("-").map(Number);
	return (
		<div
			className={cn(
				"flex w-11 shrink-0 flex-col items-center rounded-lg border py-1.5 leading-none",
				today ? "border-secondary! bg-secondary" : "border-border",
			)}
		>
			<span className="text-[11px] font-semibold uppercase text-primary">{MONTHS[(month ?? 1) - 1]}</span>
			<span className="font-heading text-lg tabular-nums">{day}</span>
		</div>
	);
}

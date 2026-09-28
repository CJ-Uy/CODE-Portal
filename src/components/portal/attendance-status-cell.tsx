import { Badge } from "@/components/ui/badge";
import { attendanceStatus, minutesLate } from "@/lib/attendance-status";

export function AttendanceStatusCell({
	scannedAt,
	startsAt,
	graceMinutes,
}: {
	scannedAt: Date | null;
	startsAt: Date;
	graceMinutes: number | null;
}) {
	if (!scannedAt) return <span className="text-xs text-muted-foreground">Absent</span>;
	if (attendanceStatus(scannedAt, startsAt, graceMinutes) === "on_time") return null;
	return (
		<Badge variant="warn" className="tabular-nums">
			+{minutesLate(scannedAt, startsAt, graceMinutes)} min
		</Badge>
	);
}
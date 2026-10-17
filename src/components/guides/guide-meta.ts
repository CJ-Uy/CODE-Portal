import { Award, CalendarCheck, CalendarPlus, ChartColumn, ClipboardList, MessageSquareText, QrCode, ScanLine, Send, type LucideIcon } from "lucide-react";
import type { BadgeProps } from "@/components/ui/badge";
import type { GuideAudience, GuideIcon } from "@/lib/guides/content";

export const GUIDE_ICONS: Record<GuideIcon, LucideIcon> = {
	"qr-code": QrCode,
	"calendar-check": CalendarCheck,
	"message-square": MessageSquareText,
	award: Award,
	"calendar-plus": CalendarPlus,
	scan: ScanLine,
	clipboard: ClipboardList,
	send: Send,
	chart: ChartColumn,
};

export const AUDIENCE_BADGE: Record<GuideAudience, BadgeProps["variant"]> = {
	member: "secondary",
	organizer: "info",
	admin: "warn",
};

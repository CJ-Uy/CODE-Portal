import { ClipboardList, FileSpreadsheet, FileText, Folder, Globe, Link2, Presentation, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Icons available for optional pinned navigation links.
export const navPinIcons = {
	ClipboardList,
	FileSpreadsheet,
	FileText,
	Folder,
	Globe,
	Presentation,
	Video,
} satisfies Record<string, LucideIcon>;

export function navPinIconFor(name: string): LucideIcon {
	return navPinIcons[name as keyof typeof navPinIcons] ?? Link2;
}

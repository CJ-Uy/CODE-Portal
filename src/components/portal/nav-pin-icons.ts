import { ClipboardList, FileSpreadsheet, FileText, Folder, Globe, Link2, Presentation, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Sidebar links show their important-link type icon, named in LINK_KIND_ICONS (src/lib/link-kinds.ts).
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

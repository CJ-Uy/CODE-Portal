import type { EmailBlock } from "./types";

export type PickerTemplate = { id: string; name: string; description?: string; subject: string; preheader: string; blocks: EmailBlock[] };

/** Every word must appear in the name, description or subject, so "event remind" finds "Event reminder". */
export function searchTemplates<T extends PickerTemplate>(templates: T[], q: string): T[] {
	const words = q.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return templates;
	return templates.filter((t) => {
		const haystack = `${t.name} ${t.description ?? ""} ${t.subject}`.toLowerCase();
		return words.every((word) => haystack.includes(word));
	});
}

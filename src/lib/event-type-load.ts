import type { EventTypeRow } from "@/db/repositories/eventTypeRules";

export type EventTypeLoad = { ok: true; rows: EventTypeRow[] } | { ok: false };

export async function loadEventTypes(list: () => Promise<EventTypeRow[]>): Promise<EventTypeLoad> {
	try {
		return { ok: true, rows: await list() };
	} catch {
		return { ok: false };
	}
}

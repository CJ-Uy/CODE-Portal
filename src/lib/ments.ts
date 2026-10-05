import type { MentsPerson } from "@/db/contract/ments";

export function mentorLine(people: MentsPerson[], id: string): MentsPerson[] {
	const byId = new Map(people.map((person) => [person.id, person]));
	const seen = new Set([id]);
	const line: MentsPerson[] = [];
	let next = byId.get(id)?.mentorId;
	while (next && !seen.has(next)) {
		seen.add(next);
		const person = byId.get(next);
		if (!person) break;
		line.push(person);
		next = person.mentorId;
	}
	return line;
}

export function mentsLabel(distance: number): string {
	return distance === 1 ? "Ments" : distance <= 4 ? `${"G".repeat(distance - 1)}ments` : `Ments, ${distance} generations up`;
}

/** Sheets clipboard text is tab-separated, so names may contain commas. */
export function parseMentsPaste(raw: string): { name: string; mentor: string }[] {
	const rows = raw.split(/\r?\n/).filter((row) => row.trim());
	if (rows.length > 201) throw new Error("Paste at most 200 relationships at a time.");
	if (/^(mentee|name)\t(ments|mentor)\s*$/i.test(rows[0]?.trim() ?? "")) rows.shift();
	if (rows.length > 200) throw new Error("Paste at most 200 relationships at a time.");
	return rows.map((row, index) => {
		const cells = row.split("\t").map((cell) => cell.trim());
		if (cells.length > 2 || !cells[0] || cells.some((cell) => cell.length > 100)) {
			throw new Error(`Row ${index + 1}: copy two columns, mentee name then ments name (100 characters each at most).`);
		}
		return { name: cells[0], mentor: cells[1] ?? "" };
	});
}

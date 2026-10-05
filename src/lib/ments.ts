import type { MentsPerson } from "@/db/contract/ments";

export const MENTS_NODE = { width: 164, height: 80, column: 200, row: 88 };

/** Packs complete branches into columns so the whole forest stays explorable. */
export function layoutMentsTree(people: MentsPerson[]) {
	const byId = new Map(people.map((person) => [person.id, person]));
	const children = new Map<string, MentsPerson[]>();
	for (const person of people) if (person.mentorId && byId.has(person.mentorId)) children.set(person.mentorId, [...(children.get(person.mentorId) ?? []), person]);
	const seen = new Set<string>();
	const branches: { root: MentsPerson; nodes: { person: MentsPerson; x: number; y: number }[]; width: number; height: number; generations: number }[] = [];
	for (const root of [...people.filter((person) => !person.mentorId || !byId.has(person.mentorId)), ...people]) {
		if (seen.has(root.id)) continue;
		let leaf = 0;
		let maxDepth = 0;
		const nodes: { person: MentsPerson; x: number; y: number }[] = [];
		const visit = (person: MentsPerson, depth: number): number => {
			seen.add(person.id);
			maxDepth = Math.max(maxDepth, depth);
			const ys = (children.get(person.id) ?? []).filter((child) => !seen.has(child.id)).map((child) => visit(child, depth + 1));
			const y = ys.length ? (ys[0] + ys.at(-1)!) / 2 : leaf++ * MENTS_NODE.row;
			nodes.push({ person, x: depth * MENTS_NODE.column, y });
			return y;
		};
		visit(root, 0);
		branches.push({ root, nodes, width: maxDepth * MENTS_NODE.column + MENTS_NODE.width, height: Math.max(1, leaf) * MENTS_NODE.row, generations: maxDepth + 1 });
	}
	branches.sort((a, b) => b.nodes.length - a.nodes.length || a.root.name.localeCompare(b.root.name));
	const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(branches.length))));
	const columnWidth = Math.max(MENTS_NODE.width, ...branches.map((branch) => branch.width)) + 64;
	const heights = Array<number>(columns).fill(16);
	const nodes = branches.flatMap((branch) => {
		const column = heights.indexOf(Math.min(...heights));
		const offset = { x: column * columnWidth + 16, y: heights[column] };
		heights[column] += branch.height + 48;
		return branch.nodes.map((node) => ({ ...node, x: node.x + offset.x, y: node.y + offset.y }));
	});
	return { nodes, branches, width: columns * columnWidth, height: Math.max(...heights), generations: Math.max(0, ...branches.map((branch) => branch.generations)) };
}

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

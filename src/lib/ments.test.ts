import { expect, it } from "vitest";
import { findMentsPerson, layoutMentsTree, MENTS_NODE, zoomMentsAt } from "./ments";

it("lays out every generation, keeps disconnected branches and handles malformed loops", () => {
	const person = (id: string, mentorId: string | null = null) => ({ id, name: id, mentorId, memberId: null, cohort: null });
	const people = [person("a"), person("b", "a"), person("c", "b"), person("d", "a"), person("e"), person("f", "g"), person("g", "f")];
	const tree = layoutMentsTree(people);
	expect(new Set(tree.nodes.map((node) => node.person.id)).size).toBe(people.length);
	expect(tree.branches[0]).toMatchObject({ root: { id: "a" }, generations: 3 });
	expect(tree.branches[0].nodes).toHaveLength(4);
	const position = (id: string) => tree.nodes.find((node) => node.person.id === id)!;
	expect(position("b").y).toBe(position("a").y + MENTS_NODE.row);
	expect(position("c").y).toBe(position("b").y + MENTS_NODE.row);
	expect(position("d").y).toBe(position("b").y);
	expect(position("a").x).toBe((position("b").x + position("d").x) / 2);
	for (const node of tree.nodes) {
		expect(node.x + MENTS_NODE.width).toBeLessThanOrEqual(tree.width);
		expect(node.y + MENTS_NODE.height).toBeLessThanOrEqual(tree.height);
	}
	expect(layoutMentsTree([]).generations).toBe(0);
});

it("locates the signed-in member without guessing an ambiguous name or claiming another account", () => {
	const member = { id: "me", name: "Charles Joshua Uy", fullName: null };
	const person = { id: "a", name: "UY, Charles Joshua T.", mentorId: null, memberId: null, cohort: null };
	expect(findMentsPerson([person], member)?.id).toBe("a");
	expect(findMentsPerson([person, { ...person, id: "b" }], member)).toBeUndefined();
	expect(findMentsPerson([{ ...person, memberId: "other" }], member)).toBeUndefined();
	expect(findMentsPerson([person, { ...person, id: "linked", name: "Different display name", memberId: "me" }], member)?.id).toBe("linked");
});

it("anchors wheel zoom to the pointer after panning, in both directions", () => {
	const offset = { x: -340, y: 80 }, point = { x: 215, y: 150 };
	const next = zoomMentsAt(offset, 0.25, 1.5, point);
	expect((point.x - next.x) / 1.5).toBe((point.x - offset.x) / 0.25);
	expect((point.y - next.y) / 1.5).toBe((point.y - offset.y) / 0.25);
	expect(zoomMentsAt(next, 1.5, 0.25, point)).toEqual(offset);
});

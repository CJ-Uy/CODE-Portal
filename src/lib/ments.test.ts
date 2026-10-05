import { expect, it } from "vitest";
import { layoutMentsTree, MENTS_NODE } from "./ments";

it("lays out every generation, keeps disconnected branches and handles malformed loops", () => {
	const person = (id: string, mentorId: string | null = null) => ({ id, name: id, mentorId, memberId: null, cohort: null });
	const people = [person("a"), person("b", "a"), person("c", "b"), person("d", "a"), person("e"), person("f", "g"), person("g", "f")];
	const tree = layoutMentsTree(people);
	expect(new Set(tree.nodes.map((node) => node.person.id)).size).toBe(people.length);
	expect(tree.branches[0]).toMatchObject({ root: { id: "a" }, generations: 3 });
	expect(tree.branches[0].nodes).toHaveLength(4);
	for (const node of tree.nodes) {
		expect(node.x + MENTS_NODE.width).toBeLessThanOrEqual(tree.width);
		expect(node.y + MENTS_NODE.height).toBeLessThanOrEqual(tree.height);
	}
	expect(layoutMentsTree([]).generations).toBe(0);
});

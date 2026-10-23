import { describe, expect, it } from "vitest";
import { pendingLabel } from "./pending-label";

describe("pendingLabel", () => {
	it("turns a leading verb into its in-progress form", () => {
		expect(pendingLabel("Save")).toBe("Saving…");
		expect(pendingLabel("Save changes")).toBe("Saving changes…");
		expect(pendingLabel("Mark all read")).toBe("Marking all read…");
		expect(pendingLabel("Add point type")).toBe("Adding point type…");
	});

	it("keeps the whitespace JSX leaves before text that follows an icon", () => {
		expect(pendingLabel(" Delete ")).toBe(" Deleting…");
	});

	it("leaves labels it does not know alone", () => {
		expect(pendingLabel("Saving…")).toBeNull();
		expect(pendingLabel("Find")).toBeNull();
		expect(pendingLabel("Clear")).toBeNull();
		expect(pendingLabel("")).toBeNull();
		expect(pendingLabel("   ")).toBeNull();
	});
});

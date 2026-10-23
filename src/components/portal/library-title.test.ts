import { describe, expect, it } from "vitest";
import { libraryPageTitle } from "./library-title";

describe("libraryPageTitle", () => {
	it.each([
		["/portal/library", "Library"],
		["/portal/library/", "Library"],
		["/portal/library/lists", "Lists"],
		["/portal/library/lists/lst_1", "Lists"],
		["/portal/library/mine", "My items"],
		["/portal/library/new", "Add to the library"],
		["/portal/library/about", "About the library"],
		["/portal/library/lib_1", "Library item"],
		["/portal/library/lib_1/edit", "Edit item"],
		["/portal/library/lib_1?x=1", "Library item"],
	])("%s is titled %s", (path, title) => {
		expect(libraryPageTitle(path)).toBe(title);
	});

	it("leaves other paths to the shell", () => {
		expect(libraryPageTitle("/portal/calendar")).toBeNull();
		expect(libraryPageTitle("/portal/libraryish")).toBeNull();
		expect(libraryPageTitle("/portal/library/lib_1/edit/more")).toBeNull();
	});
});

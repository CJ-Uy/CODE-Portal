import { expect, it } from "vitest";
import { searchTemplates } from "./template-search";

it("matches every query word across name, description and subject", () => {
	const t = (id: string, name: string, subject = "", description?: string) => ({ id, name, subject, description, preheader: "", blocks: [] });
	const list = [t("a", "Event reminder", "See you soon"), t("b", "Welcome to CODE", "Hi", "A warm introduction"), t("c", "Roundup", "Your CODE roundup")];
	const ids = (q: string) => searchTemplates(list, q).map((x) => x.id);
	expect(ids("")).toEqual(["a", "b", "c"]);
	expect(ids("remind  EVENT")).toEqual(["a"]);
	expect(ids("warm")).toEqual(["b"]);
	expect(ids("code")).toEqual(["b", "c"]);
	expect(ids("code soon")).toEqual([]);
});

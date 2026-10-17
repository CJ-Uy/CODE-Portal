import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createLibraryObjectAccess } from "./library-access";
import { actors, insertItem, resetLibrary, seedMembers } from "./library-test-fixtures";

const access = createLibraryObjectAccess(drizzle(env.DB, { schema }));

beforeEach(async () => {
	await resetLibrary();
	await seedMembers(["owner", "other", "moderator"]);
});

describe("library object access", () => {
	it("lets members read published items and only the owner or a moderator read drafts", async () => {
		await insertItem({ id: "pub", createdBy: "owner" });
		await insertItem({ id: "draft", status: "draft", createdBy: "owner" });
		expect(await access.canReadLibraryObject(actors.other, "pub")).toBe(true);
		expect(await access.canReadLibraryObject(actors.other, "draft")).toBe(false);
		expect(await access.canReadLibraryObject(actors.owner, "draft")).toBe(true);
		expect(await access.canReadLibraryObject(actors.moderator, "draft")).toBe(true);
	});

	it("hides confidential files from members and shows them to the owner and library:manage holders", async () => {
		await insertItem({ id: "conf", confidentiality: "confidential", createdBy: "owner" });
		expect(await access.canReadLibraryObject(actors.other, "conf")).toBe(false);
		expect(await access.canReadLibraryObject(actors.owner, "conf")).toBe(true);
		expect(await access.canReadLibraryObject(actors.moderator, "conf")).toBe(true);
	});

	it("lets only the owner or a moderator edit, and nobody edit a missing item", async () => {
		await insertItem({ id: "pub", createdBy: "owner" });
		expect(await access.canEditLibraryItem(actors.owner, "pub")).toBe(true);
		expect(await access.canEditLibraryItem(actors.moderator, "pub")).toBe(true);
		expect(await access.canEditLibraryItem(actors.other, "pub")).toBe(false);
		expect(await access.canEditLibraryItem(actors.moderator, "missing")).toBe(false);
		expect(await access.canReadLibraryObject(actors.moderator, "missing")).toBe(false);
	});
});

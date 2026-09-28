import { describe, expect, it } from "vitest";
import { creatorPermissionOptions, creatorPermissionValue } from "./event-type-creator-permissions";

describe("event type creator permissions", () => {
	it("shows each authorization audience once", () => {
		expect(creatorPermissionOptions.map((option) => option.label)).toEqual([
			"Any member",
			"Events admins only",
			"Retention admins only",
			"Link admins only",
			"Member admins only",
			"Publishing admins only",
			"Super admins only",
		]);
	});

	it("maps existing low-level permissions to their audience", () => {
		expect(creatorPermissionValue("event:moderate")).toBe("event:create_restricted");
		expect(creatorPermissionValue("retention:configure")).toBe("retention:record");
		expect(creatorPermissionValue("library:moderate")).toBe("announcement:manage");
		expect(creatorPermissionValue("unknown:legacy")).toBe("survey:configure");
	});
});

import { describe, expect, it } from "vitest";
import { actorDisplay, describeAudit, type AuditPhraseInput } from "./audit-phrasing";

const ACTIONS = [
	"announcement:create",
	"announcement:delete",
	"announcement:update",
	"event:add_media",
	"event:add_staff",
	"event:create",
	"event:delete",
	"event:invite",
	"event:remove_retired_award",
	"event:remove_staff",
	"event:scan_attendance",
	"event:set_awards",
	"event:transfer",
	"event:undo_scan",
	"event:update",
	"forum:reveal_author",
	"library:access_request",
	"library:create",
	"library:delete",
	"library:update",
	"link:create",
	"member:create",
	"member:delete",
	"member:profile_update",
	"member:self_provision",
	"nav_pin:create",
	"nav_pin:delete",
	"nav_pin:update",
	"point_type:create",
	"point_type:update",
	"quick_link:create",
	"quick_link:delete",
	"quick_link:update",
	"retention:record_manual",
	"role:assign",
	"roster:add",
	"roster:bulk_add",
	"roster:remove",
	"seed:load",
	"survey:create",
	"survey:sample",
] as const;

const input: AuditPhraseInput = {
	action: "event:create",
	actorName: "Ana Reyes",
	actorContext: "session",
	sharedTokenLabel: null,
	targetLabel: "Study Jam",
	targetMemberName: "Miguel Cruz",
	detail: null,
};

describe("audit phrasing", () => {
	it("humanizes every known action", () => {
		for (const action of ACTIONS) {
			const phrase = describeAudit({ ...input, action });
			expect(phrase).not.toBe(action);
			expect(phrase).not.toBe("");
		}
	});

	it("humanizes unknown actions", () => {
		expect(describeAudit({ ...input, action: "event:brand_new" })).toBe("event — brand new");
	});

	it("never attributes shared-token work to a member", () => {
		const display = actorDisplay({ ...input, actorContext: "shared_dev_token", sharedTokenLabel: "ci-dev" });
		expect(display).toBe("Shared token · ci-dev");
		expect(display).not.toContain(input.actorName);
	});

	it("handles a shared token without a label", () => {
		expect(actorDisplay({ ...input, actorContext: "shared_dev_token", sharedTokenLabel: null })).toBe("Shared token");
	});

	it("labels a deleted session actor", () => {
		expect(actorDisplay({ ...input, actorName: null })).toBe("Deleted member");
	});

	it("omits a missing target cleanly", () => {
		const phrase = describeAudit({ ...input, action: "event:create", targetLabel: null, targetMemberName: null });
		expect(phrase).toBe("created event");
		expect(phrase).not.toContain("null");
		expect(phrase).not.toMatch(/[\s:—-]$/);
	});

	it("appends detail as plain text", () => {
		expect(describeAudit({ ...input, detail: "<strong>42 members</strong>" })).toBe(
			"created event Study Jam — <strong>42 members</strong>",
		);
	});

	it("uses member and event names where needed", () => {
		expect(describeAudit({ ...input, action: "event:scan_attendance" })).toBe("checked in Miguel Cruz at Study Jam");
		expect(describeAudit({ ...input, action: "role:assign" })).toBe("assigned a role to Miguel Cruz");
		expect(describeAudit({ ...input, action: "member:delete" })).toBe("deleted member Miguel Cruz");
	});
});

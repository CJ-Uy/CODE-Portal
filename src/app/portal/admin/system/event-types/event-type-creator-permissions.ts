import type { PermissionAction } from "@/server/auth/permissions";

export const creatorPermissionOptions = [
	{ value: "", label: "Any member" },
	{ value: "event:create_restricted", label: "Events admins only" },
	{ value: "retention:record", label: "Retention admins only" },
	{ value: "link:moderate", label: "Link admins only" },
	{ value: "member:manage", label: "Member admins only" },
	{ value: "announcement:manage", label: "Publishing admins only" },
	{ value: "survey:configure", label: "Super admins only" },
] as const satisfies ReadonlyArray<{ value: PermissionAction | ""; label: string }>;

const creatorPermissionValues: Record<PermissionAction, (typeof creatorPermissionOptions)[number]["value"]> = {
	"event:moderate": "event:create_restricted",
	"event:points": "event:create_restricted",
	"event:create_restricted": "event:create_restricted",
	"points:assign": "retention:record",
	"retention:record": "retention:record",
	"retention:configure": "retention:record",
	"link:moderate": "link:moderate",
	"role:assign": "member:manage",
	"survey:configure": "survey:configure",
	"member:manage": "member:manage",
	"roster:manage": "member:manage",
	"nav:configure": "member:manage",
	"announcement:manage": "announcement:manage",
	"library:manage": "announcement:manage",
	"library:moderate": "announcement:manage",
};

export function creatorPermissionValue(current: string) {
	if (current === "") return "";
	return creatorPermissionValues[current as PermissionAction] ?? "survey:configure";
}

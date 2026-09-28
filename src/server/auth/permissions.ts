export const roleKeys = ["super", "member", "events", "link", "retention", "member_admin", "publishing"] as const;

export type RoleKey = (typeof roleKeys)[number];

const roleKeyAliases: Record<string, RoleKey> = {
	calendar: "events",
	crs: "retention",
};

export function normalizeRoleKey(value: string | null | undefined): RoleKey | null {
	if (!value) return null;
	if ((roleKeys as readonly string[]).includes(value)) return value as RoleKey;
	return roleKeyAliases[value] ?? null;
}

export function normalizeRoleKeys(values: Iterable<string | null | undefined>): RoleKey[] {
	const normalized = new Set<RoleKey>();
	for (const value of values) {
		const key = normalizeRoleKey(value);
		if (key) normalized.add(key);
	}
	return [...normalized];
}

export const permissionActions = [
	"event:moderate",
	"event:points",
	"event:create_restricted",
	"points:assign",
	"retention:record",
	"retention:configure",
	"link:moderate",
	"role:assign",
	"survey:configure",
	"member:manage",
	"roster:manage",
	"nav:configure",
	"announcement:manage",
	"library:manage",
	"library:moderate",
] as const;

export type PermissionAction = (typeof permissionActions)[number];

export type Actor = {
	memberId: string;
	roles: RoleKey[];
	context?: "session" | "shared_dev_token";
	sharedTokenHash?: string | null;
	sharedTokenLabel?: string | null;
};

const rolePermissions: Record<Exclude<RoleKey, "super" | "member">, PermissionAction[]> = {
	events: ["event:moderate", "event:points", "event:create_restricted"],
	link: ["link:moderate"],
	retention: ["points:assign", "retention:record", "retention:configure"],
	member_admin: ["member:manage", "role:assign", "roster:manage", "nav:configure"],
	publishing: ["announcement:manage", "library:manage", "library:moderate"],
};

export function can(actor: Actor | null, action: PermissionAction): boolean {
	if (!actor) return false;
	if (actor.roles.includes("super")) return true;
	return actor.roles.some((role) => {
		if (role === "member" || role === "super") return false;
		return rolePermissions[role].includes(action);
	});
}

import type { Actor } from "./permissions";
import { can, permissionActions } from "./permissions";

export function hasAnyAdminScope(actor: Actor | null): boolean {
	if (!actor) return false;
	return permissionActions.some((action) => can(actor, action));
}

export function assertAdminScope(actor: Actor | null): Actor {
	if (!actor || !hasAnyAdminScope(actor)) {
		throw new Error("Not authorized to access the admin module.");
	}
	return actor;
}

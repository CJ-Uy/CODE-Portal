import { z } from "zod";

/**
 * Event types are admin-managed rows, so a boundary schema can no longer validate MEMBERSHIP.
 * It validates SHAPE only; existence, active state, and permission are enforced in
 * `events.create` / `events.update` via `canCreateType`, which fails closed.
 */
export const eventTypeKeySchema = z
	.string()
	.trim()
	.min(1)
	.max(32)
	.regex(/^[a-z0-9_]+$/, "Event type keys are lowercase letters, digits and underscores.");

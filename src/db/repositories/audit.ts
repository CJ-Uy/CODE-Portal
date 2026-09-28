import { and, desc, eq, inArray } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
	announcements,
	auditLogs,
	crsEvents,
	eventTypeRules,
	libraryItems,
	members,
	navPins,
	pointTypes,
	quickLinks,
	shortLinks,
	surveys,
} from "@/db/schema";
import { createId } from "@/lib/ids";
import type { Actor } from "@/server/auth/permissions";
import { hasAnyAdminScope } from "@/server/auth/admin";
import type * as schema from "../schema";

export type AuditCategory =
	| "role"
	| "event"
	| "retention"
	| "survey"
	| "link"
	| "member"
	| "announcement"
	| "library";

export type AuditRecordInput = {
	action: string;
	targetType: string;
	targetId: string;
	category: AuditCategory;
	detail?: string | null;
	targetMemberId?: string | null;
};

export type AuditEntry = InferSelectModel<typeof auditLogs>;

export type AuditEntryView = AuditEntry & {
	actorName: string | null;
	targetMemberName: string | null;
	targetLabel: string | null;
};

export type AuditRepository = {
	record(actor: Actor, input: AuditRecordInput): Promise<void>;
	list(actor: Actor, options?: { actorMemberId?: string; category?: AuditCategory; limit?: number }): Promise<AuditEntryView[]>;
};

type AuditInsert = InferInsertModel<typeof auditLogs>;
type Db = DrizzleD1Database<typeof schema>;

// Minimal structural handle other repositories intersect with their own db
// cast when they record audit entries directly.
export type AuditDb = {
	insert(table: typeof auditLogs): {
		values(value: AuditInsert): Promise<unknown> | { then: Promise<unknown>["then"] };
	};
};

export function auditInsertValues(actor: Actor, input: AuditRecordInput): AuditInsert {
	return {
		id: createId("aud"),
		actorMemberId: actor.memberId,
		actorContext: actor.context ?? "session",
		sharedTokenHash: actor.sharedTokenHash ?? null,
		sharedTokenLabel: actor.sharedTokenLabel ?? null,
		action: input.action,
		targetType: input.targetType,
		targetId: input.targetId,
		detail: input.detail ?? null,
		targetMemberId: input.targetMemberId ?? null,
		category: input.category,
	};
}

export function createAuditRepository(db: Db): AuditRepository {
	return {
		async record(actor, input) {
			await db.insert(auditLogs).values(auditInsertValues(actor, input));
		},
		async list(actor, options) {
			if (!hasAnyAdminScope(actor)) {
				throw new Error("Not authorized to view the audit log.");
			}
			const limit = options?.limit ?? 100;
			const rows = await db
				.select()
				.from(auditLogs)
				.where(
					and(
						options?.category ? eq(auditLogs.category, options.category) : undefined,
						options?.actorMemberId ? eq(auditLogs.actorMemberId, options.actorMemberId) : undefined,
					),
				)
				.orderBy(desc(auditLogs.createdAt))
				.limit(limit);

			const memberIds = [
				...new Set(
					rows
						.flatMap((entry) => [entry.actorMemberId, entry.targetMemberId])
						.filter((memberId): memberId is string => memberId !== null),
				),
			];
			const memberRows = memberIds.length
				? await db
						.select({ id: members.id, fullName: members.fullName, name: members.name })
						.from(members)
						.where(inArray(members.id, memberIds))
				: [];
			const memberNames = new Map(
				memberRows.map((member) => [member.id, member.fullName ?? member.name] as const),
			);

			const targetIdsByType = new Map<string, Set<string>>();
			for (const entry of rows) {
				const targetIds = targetIdsByType.get(entry.targetType) ?? new Set<string>();
				targetIds.add(entry.targetId);
				targetIdsByType.set(entry.targetType, targetIds);
			}
			const targetLabels = new Map<string, string>();
			const rememberLabels = (targetType: string, targets: { id: string; label: string | null }[]) => {
				for (const target of targets) {
					if (target.label) targetLabels.set(`${targetType}:${target.id}`, target.label);
				}
			};

			await Promise.all(
				[...targetIdsByType].map(async ([targetType, ids]) => {
					const targetIds = [...ids];
					switch (targetType) {
						case "event":
							rememberLabels(
								targetType,
								await db
									.select({ id: crsEvents.id, label: crsEvents.title })
									.from(crsEvents)
									.where(inArray(crsEvents.id, targetIds)),
							);
							break;
						case "link": {
							const targets = await db
								.select({ id: shortLinks.id, title: shortLinks.title, slug: shortLinks.slug })
								.from(shortLinks)
								.where(inArray(shortLinks.id, targetIds));
							rememberLabels(
								targetType,
								targets.map((target) => ({ id: target.id, label: target.title || target.slug })),
							);
							break;
						}
						case "announcement":
							rememberLabels(
								targetType,
								await db
									.select({ id: announcements.id, label: announcements.title })
									.from(announcements)
									.where(inArray(announcements.id, targetIds)),
							);
							break;
						case "library_item":
							rememberLabels(
								targetType,
								await db
									.select({ id: libraryItems.id, label: libraryItems.title })
									.from(libraryItems)
									.where(inArray(libraryItems.id, targetIds)),
							);
							break;
						case "point_type":
							rememberLabels(
								targetType,
								await db
									.select({ id: pointTypes.id, label: pointTypes.label })
									.from(pointTypes)
									.where(inArray(pointTypes.id, targetIds)),
							);
							break;
						case "survey":
							rememberLabels(
								targetType,
								await db
									.select({ id: surveys.id, label: surveys.title })
									.from(surveys)
									.where(inArray(surveys.id, targetIds)),
							);
							break;
						case "nav_pin":
							rememberLabels(
								targetType,
								await db
									.select({ id: navPins.id, label: navPins.label })
									.from(navPins)
									.where(inArray(navPins.id, targetIds)),
							);
							break;
						case "quick_link":
							rememberLabels(
								targetType,
								await db
									.select({ id: quickLinks.id, label: quickLinks.label })
									.from(quickLinks)
									.where(inArray(quickLinks.id, targetIds)),
							);
							break;
						case "event_type":
							rememberLabels(
								targetType,
								await db
									.select({ id: eventTypeRules.type, label: eventTypeRules.label })
									.from(eventTypeRules)
									.where(inArray(eventTypeRules.type, targetIds)),
							);
							break;
						case "member":
							rememberLabels(
								targetType,
								targetIds.map((id) => ({ id, label: memberNames.get(id) ?? null })),
							);
							break;
					}
				}),
			);

			return rows.map((entry) => ({
				...entry,
				actorName: entry.actorMemberId ? (memberNames.get(entry.actorMemberId) ?? null) : null,
				targetMemberName: entry.targetMemberId ? (memberNames.get(entry.targetMemberId) ?? null) : null,
				targetLabel: targetLabels.get(`${entry.targetType}:${entry.targetId}`) ?? null,
			}));
		},
	};
}

export function createUnavailableAuditRepository(): AuditRepository {
	const unavailable = () => {
		throw new Error("Audit writes are unavailable through this repository adapter.");
	};
	return {
		record: unavailable,
		list: unavailable,
	};
}

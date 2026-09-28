import { desc } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { articleFeedback, contactSubmissions } from "@/db/schema";
import { createId } from "@/lib/ids";
import type { Actor } from "@/server/auth/permissions";
import { hasAnyAdminScope } from "@/server/auth/admin";
import type * as schema from "../schema";

export type ContactSubmission = InferSelectModel<typeof contactSubmissions>;
export type ArticleFeedback = InferSelectModel<typeof articleFeedback>;

export type ContactSubmissionInput = {
	name: string;
	organization: string;
	email: string;
	orgSegment: string;
	message: string;
};
export type ArticleFeedbackInput = { articleSlug: string; rating: number; comment?: string | null };

type Db = DrizzleD1Database<typeof schema>;

export type SubmissionsRepository = {
	createContact(input: ContactSubmissionInput): Promise<void>;
	createFeedback(input: ArticleFeedbackInput): Promise<void>;
	listContact(actor: Actor, options?: { limit?: number }): Promise<ContactSubmission[]>;
	listFeedback(actor: Actor, options?: { limit?: number }): Promise<ArticleFeedback[]>;
};

function assertView(actor: Actor): void {
	// Submissions hold inquiry contact details; gate reads behind any admin scope.
	if (!hasAnyAdminScope(actor)) throw new Error("Not authorized to view submissions.");
}

export function createSubmissionsRepository(db: Db): SubmissionsRepository {
	return {
		async createContact(input) {
			await db.insert(contactSubmissions).values({ id: createId("cts"), ...input });
		},
		async createFeedback(input) {
			await db
				.insert(articleFeedback)
				.values({ id: createId("fbk"), articleSlug: input.articleSlug, rating: input.rating, comment: input.comment ?? null });
		},
		async listContact(actor, options) {
			assertView(actor);
			return db.select().from(contactSubmissions).orderBy(desc(contactSubmissions.createdAt)).limit(options?.limit ?? 100);
		},
		async listFeedback(actor, options) {
			assertView(actor);
			return db.select().from(articleFeedback).orderBy(desc(articleFeedback.createdAt)).limit(options?.limit ?? 100);
		},
	};
}

export function createUnavailableSubmissionsRepository(): SubmissionsRepository {
	const unavailable = () => {
		throw new Error("Submissions are unavailable through this repository adapter.");
	};
	return { createContact: unavailable, createFeedback: unavailable, listContact: unavailable, listFeedback: unavailable };
}

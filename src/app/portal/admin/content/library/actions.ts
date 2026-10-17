"use server";

import { revalidatePath } from "next/cache";
import type { ZodError, ZodType } from "zod";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { assertFeatureEnabled } from "@/server/features";
import {
	deleteTagInputSchema,
	itemInputSchema,
	itemReasonInputSchema,
	listInputSchema,
	mergeTagsInputSchema,
	regroupTagInputSchema,
	renameTagInputSchema,
	reportInputSchema,
	reportReasonInputSchema,
} from "./input";

const PAGE = "/portal/admin/content/library";

// These throw on failure (the client shows the message through actionErrorMessage); a rejected input names its first problem.
const firstIssue = (error: ZodError) => error.issues[0]?.message ?? "Check what you entered and try again.";

/** Feature flag, signed-in moderator, repositories, and the input checked: nothing reaches a repository unchecked. */
async function guard<T>(schema: ZodType<T>, input: unknown) {
	assertFeatureEnabled("library");
	const actor = await requireActor();
	if (!can(actor, "library:moderate")) throw new Error("Not authorized to moderate the library.");
	const parsed = schema.safeParse(input);
	if (!parsed.success) throw new Error(firstIssue(parsed.error));
	return { actor, repositories: await getRepositories(), input: parsed.data };
}

function revalidateItem(itemId: string) {
	revalidatePath(PAGE);
	revalidatePath(`/portal/library/${itemId}`);
	revalidatePath("/portal/library");
	revalidatePath("/portal/library/lists");
	revalidatePath("/portal/library/mine");
}

function revalidateList(listId: string) {
	revalidatePath(PAGE);
	revalidatePath("/portal/library");
	revalidatePath("/portal/library/lists");
	revalidatePath(`/portal/library/lists/${listId}`);
}

/** A tag change reaches every tagged item's page, the filter chips and the editor's tag picker. */
function revalidateTags() {
	revalidatePath(PAGE);
	revalidatePath("/portal/library", "layout");
}

export async function approveItemAction(input: { itemId: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(itemInputSchema, input);
	await repositories.library.moderate(actor, data.itemId, "approve");
	revalidateItem(data.itemId);
}

/** The owner reads the reason. */
export async function sendBackItemAction(input: { itemId: string; reason: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(itemReasonInputSchema, input);
	await repositories.library.moderate(actor, data.itemId, "send_back", data.reason);
	revalidateItem(data.itemId);
}

export async function restoreItemAction(input: { itemId: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(itemInputSchema, input);
	await repositories.library.moderate(actor, data.itemId, "restore");
	revalidateItem(data.itemId);
}

/** The list stays unshared until its owner shares it again. The moderator stays on this page, so unlike the list page there is nowhere to be sent away from. */
export async function restoreListFromQueueAction(input: { listId: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(listInputSchema, input);
	await repositories.libraryLists.restore(actor, data.listId);
	revalidateList(data.listId);
}

type Guarded = Awaited<ReturnType<typeof guard>>;

/**
 * The report's target comes from the open queue, never from the request: the pages to refresh are the report's own,
 * and a report that is not open any more (another moderator got there first) is refused before anything is written.
 */
async function resolve({ actor, repositories }: Pick<Guarded, "actor" | "repositories">, reportId: string, resolution: "dismissed" | "taken_down", reason?: string) {
	const { reports } = await repositories.library.moderationQueue(actor);
	const report = reports.find((candidate) => candidate.id === reportId);
	if (!report) throw new Error("This report was already resolved.");
	await repositories.library.resolveReport(actor, report.id, resolution, reason);
	if (report.itemId) revalidateItem(report.itemId);
	if (report.listId) revalidateList(report.listId);
}

export async function dismissReportAction(input: { reportId: string }): Promise<void> {
	const { input: data, ...context } = await guard(reportInputSchema, input);
	await resolve(context, data.reportId, "dismissed");
}

/** Takes the item or list down with the reason, then closes the report. */
export async function takeDownReportAction(input: { reportId: string; reason: string }): Promise<void> {
	const { input: data, ...context } = await guard(reportReasonInputSchema, input);
	await resolve(context, data.reportId, "taken_down", data.reason);
}

/**
 * For a report whose target is already out of view (taken down, or back in review or draft since): there is nothing left to
 * take down, so no reason is asked and the repository just closes the report as handled. A target that is still live is
 * refused for want of a reason, so this cannot take anything down.
 */
export async function closeReportAction(input: { reportId: string }): Promise<void> {
	const { input: data, ...context } = await guard(reportInputSchema, input);
	await resolve(context, data.reportId, "taken_down");
}

export async function renameTagAction(input: { tagId: string; name: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(renameTagInputSchema, input);
	await repositories.libraryTags.renameTag(actor, data.tagId, data.name);
	revalidateTags();
}

/** An empty group name puts the tag back in "Ungrouped". */
export async function regroupTagAction(input: { tagId: string; groupName: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(regroupTagInputSchema, input);
	await repositories.libraryTags.regroupTag(actor, data.tagId, data.groupName);
	revalidateTags();
}

/** Every item carrying `fromId` gets `intoId` instead, and `fromId` is deleted. */
export async function mergeTagsAction(input: { fromId: string; intoId: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(mergeTagsInputSchema, input);
	await repositories.libraryTags.mergeTags(actor, data.fromId, data.intoId);
	revalidateTags();
}

/** The tag comes off every item that carries it. */
export async function deleteTagAction(input: { tagId: string }): Promise<void> {
	const { actor, repositories, input: data } = await guard(deleteTagInputSchema, input);
	await repositories.libraryTags.deleteTag(actor, data.tagId);
	revalidateTags();
}

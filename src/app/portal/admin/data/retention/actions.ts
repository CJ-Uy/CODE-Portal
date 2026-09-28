"use server";

import { revalidatePath } from "next/cache";
import { getRepositories } from "@/db";
import { createManualRetentionRecordInputSchema } from "@/db/types";
import { requireActor } from "@/server/auth/actor";

export type RecordRetentionResult = { ok: true; count: number } | { ok: false; error: string };

export async function recordRetentionAction(
	_prev: RecordRetentionResult | null,
	formData: FormData,
): Promise<RecordRetentionResult> {
	const actor = await requireActor();

	const parsed = createManualRetentionRecordInputSchema.safeParse({
		memberIds: formData.getAll("memberIds").map(String),
		termId: nullableText(formData.get("termId")) ?? "",
		pointTypeId: nullableText(formData.get("pointTypeId")) ?? "",
		eventId: nullableText(formData.get("eventId")),
		points: parsePoints(formData.get("points")),
		reason: nullableText(formData.get("reason")) ?? "",
	});
	if (!parsed.success) {
		return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
	}

	try {
		const repositories = await getRepositories();
		const result = await repositories.retention.createManual(actor, parsed.data);
		revalidatePath("/portal/admin/data");
		revalidatePath("/portal/admin/data/retention");
		return { ok: true, count: result.recordIds.length };
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to record retention.";
		return { ok: false, error: message };
	}
}

function nullableText(value: FormDataEntryValue | null): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed || null;
}

function parsePoints(value: FormDataEntryValue | null): number | null {
	if (typeof value !== "string" || value.trim() === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

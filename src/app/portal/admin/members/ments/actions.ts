"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getRepositories } from "@/db";
import { mentsContract } from "@/db/contract/ments";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";

export async function mutateMentsAction(input: { kind: "save" | "remove" | "import"; value: unknown }): Promise<{ message?: string; error?: string }> {
	try {
		assertFeatureEnabled("ments");
		const actor = await requireActor();
		const { ments } = await getRepositories();
		let message: string;
		if (input.kind === "save") {
			await ments.save(actor, mentsContract.save.input.parse(input.value));
			message = "Person saved.";
		} else if (input.kind === "remove") {
			await ments.remove(actor, mentsContract.remove.input.parse(input.value).id);
			message = "Person removed.";
		} else if (input.kind === "import") {
			const result = await ments.import(actor, mentsContract.import.input.parse(input.value).raw);
			message = `${result.added} ${result.added === 1 ? "person" : "people"} added, ${result.linked} ${result.linked === 1 ? "relationship" : "relationships"} linked.`;
		} else throw new Error("Unknown tree action.");
		revalidatePath("/portal/ments");
		revalidatePath("/portal/admin/members/ments");
		return { message };
	} catch (error) {
		return { error: error instanceof ZodError ? error.issues[0]?.message : error instanceof Error && !error.cause ? error.message : "Could not update the ments tree. Try again." };
	}
}

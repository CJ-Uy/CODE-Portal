import { ZodError } from "zod";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Next masks thrown server-action errors in production, so email actions return their
 * failure as data. Repository errors are written for members to read.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
	try {
		return { ok: true, data: await fn() };
	} catch (error) {
		if (error instanceof ZodError) return { ok: false, error: error.issues[0]?.message ?? "Check the form and try again." };
		return { ok: false, error: error instanceof Error ? error.message : "Something went wrong. Try again." };
	}
}

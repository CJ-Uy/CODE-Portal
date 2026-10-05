import { z } from "zod";

const rateSchema = z.object({ result: z.literal("success"), base_code: z.literal("USD"), time_last_update_unix: z.number().positive(), rates: z.object({ PHP: z.number().min(1).max(1000) }) });

export function parsePhpRate(value: unknown) {
	const parsed = rateSchema.safeParse(value);
	if (!parsed.success) return null;
	return { rate: parsed.data.rates.PHP, updatedAt: parsed.data.time_last_update_unix * 1000 };
}

export async function getPhpRate() {
	try {
		const response = await fetch("https://open.er-api.com/v6/latest/USD", { next: { revalidate: 3600 }, signal: AbortSignal.timeout(3000) });
		return response.ok ? parsePhpRate(await response.json()) : null;
	} catch { return null; }
}

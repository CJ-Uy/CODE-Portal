import { expect, it } from "vitest";
import { parsePhpRate } from "./pricing";

it("uses a dated USD/PHP quote and rejects missing, wrong-base and invalid rates", () => {
	const quote = { result: "success", base_code: "USD", time_last_update_unix: 1791158551, rates: { PHP: 62.63269 } };
	expect(parsePhpRate(quote)).toEqual({ rate: 62.63269, updatedAt: 1791158551000 });
	for (const bad of [{}, { ...quote, base_code: "EUR" }, { ...quote, rates: { PHP: -1 } }, { ...quote, rates: { PHP: Infinity } }]) expect(parsePhpRate(bad)).toBeNull();
});

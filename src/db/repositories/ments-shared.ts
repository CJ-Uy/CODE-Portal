import { mentsContract } from "@/db/contract/ments";
import { proxySharedApiRequest } from "@/server/shared-api";
import type { MentsRepository } from "./ments";

export function createSharedMentsRepository(): MentsRepository {
	async function request(method: string, body?: unknown, query = "") {
		const response = await proxySharedApiRequest(new Request(`http://localhost/internal/ments${query}`, {
			method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
		}), `/internal/ments${query}`);
		const result = await response.json();
		if (!response.ok) throw new Error(typeof result === "object" && result && "error" in result ? String(result.error) : "The ments tree could not be updated.");
		return result;
	}
	return {
		list: async () => mentsContract.list.output.parse(await request("GET")).people,
		manage: async () => mentsContract.manage.output.parse(await request("GET", undefined, "?manage=1")).people,
		save: async (_actor, input) => mentsContract.save.output.parse(await request("POST", mentsContract.save.input.parse(input))).person,
		remove: async (_actor, id) => { mentsContract.remove.output.parse(await request("DELETE", mentsContract.remove.input.parse({ id }))); },
		import: async (_actor, raw) => mentsContract.import.output.parse(await request("PUT", mentsContract.import.input.parse({ raw }))),
	};
}

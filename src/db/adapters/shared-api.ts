import { getAppConfig } from "@/server/env";
import type { CreateMemberInput, DatabaseAdapter, Member, UpdateMemberProfileInput } from "../types";

export class SharedApiDatabaseAdapter implements DatabaseAdapter {
	readonly adapterType = "shared-api" as const;

	constructor(
		private readonly fetcher: (request: Request) => Promise<Response> = fetch,
		private readonly options?: { baseUrl: string; token: string },
	) {}

	private request(path: string, init?: RequestInit): Promise<Response> {
		const config = getAppConfig();
		const baseUrl = this.options?.baseUrl ?? config.SHARED_API_BASE_URL;
		const token = this.options?.token ?? config.SHARED_API_TOKEN;
		if (!baseUrl || !token) {
			throw new Error("Shared API configuration is missing.");
		}

		return this.fetcher(new Request(new URL(path, baseUrl), {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				...init?.headers,
			},
		}));
	}

	async listMembers(): Promise<Member[]> {
		const response = await this.request("/internal/members");
		if (!response.ok) throw new Error("Shared API failed to list members.");
		const body = await response.json() as { members: Member[] };
		return body.members.map(deserializeMember);
	}

	async createMember(input: CreateMemberInput): Promise<Member> {
		const response = await this.request("/internal/members", {
			method: "POST",
			body: JSON.stringify(input),
		});
		if (!response.ok) throw new Error("Shared API failed to create member.");
		const body = await response.json() as { member: Member };
		return deserializeMember(body.member);
	}

	async getMemberById(id: string): Promise<Member | null> {
		const response = await this.request(`/internal/members/${encodeURIComponent(id)}`);
		if (response.status === 404) return null;
		if (!response.ok) throw new Error("Shared API failed to fetch member.");
		const body = await response.json() as { member: Member };
		return deserializeMember(body.member);
	}

	async updateMemberProfile(id: string, input: UpdateMemberProfileInput): Promise<Member> {
		const response = await this.request("/internal/members", {
			method: "PATCH",
			body: JSON.stringify(input),
		});
		if (!response.ok) throw new Error("Shared API failed to update the member profile.");
		const body = await response.json() as { member: Member };
		const member = deserializeMember(body.member);
		if (member.id !== id) throw new Error("Shared API returned the wrong member profile.");
		return member;
	}
}

function deserializeMember(member: Member): Member {
	return {
		...member,
		emailVerified: member.emailVerified ? new Date(member.emailVerified) : null,
		createdAt: new Date(member.createdAt),
		updatedAt: new Date(member.updatedAt),
	};
}

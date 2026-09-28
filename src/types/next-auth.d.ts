import type { DefaultSession } from "next-auth";
import type { MemberStatus } from "@/db/schema";
import type { RoleKey } from "@/server/auth/permissions";

declare module "next-auth" {
	interface Session {
		user: {
			id: string;
			roles: RoleKey[];
			status: MemberStatus;
		} & DefaultSession["user"];
	}

	interface User {
		status?: MemberStatus;
	}
}

import { can, type Actor } from "@/server/auth/permissions";

export function assertEmail(actor: Actor, action: "email:send" | "email:configure"): void {
	if (!can(actor, action)) {
		throw new Error(action === "email:configure" ? "Not authorized to manage email settings." : "Not authorized to send email.");
	}
}

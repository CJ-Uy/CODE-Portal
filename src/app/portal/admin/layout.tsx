import { redirect } from "next/navigation";
import { signInPath } from "@/server/auth/sign-in";
import { getActor } from "@/server/auth/actor";
import { hasAnyAdminScope } from "@/server/auth/admin";

export const dynamic = "force-dynamic";

// The admin navigation now lives in the portal shell's sidebar (it swaps to an
// admin nav on /portal/admin). This layout only guards access and wraps content.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
	const actor = await getActor();
	if (!actor) redirect(await signInPath());
	if (!hasAnyAdminScope(actor)) redirect("/portal");

	return <div className="grid gap-6">{children}</div>;
}

import { notFound, redirect } from "next/navigation";
import { ToastProvider } from "@/components/ui/toast";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";

export default async function EmailAdminLayout({ children }: { children: React.ReactNode }) {
	if (!isFeatureEnabled("email")) notFound();
	const actor = await requireActor();
	if (!can(actor, "email:send")) redirect("/portal/admin");
	return <ToastProvider>{children}</ToastProvider>;
}

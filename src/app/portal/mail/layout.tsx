import { notFound } from "next/navigation";
import { ToastProvider } from "@/components/ui/toast";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";

export default function MailLayout({ children }: { children: React.ReactNode }) {
	if (!isFeatureEnabled("email")) notFound();
	return <ToastProvider>{children}</ToastProvider>;
}

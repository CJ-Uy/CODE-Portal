import { notFound } from "next/navigation";
import { ToastProvider } from "@/components/ui/toast";
import { isFeatureEnabled } from "@/server/features";

// Every gallery page sits behind the release flag; the portal layout above has already required a signed-in member.
export default function GalleryLayout({ children }: { children: React.ReactNode }) {
	if (!isFeatureEnabled("gallery")) notFound();
	return <ToastProvider>{children}</ToastProvider>;
}

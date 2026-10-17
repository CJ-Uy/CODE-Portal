import { ToastProvider } from "@/components/ui/toast";

// Every library page has its own guards; this only gives the client components below a toast to call.
export default function LibraryLayout({ children }: { children: React.ReactNode }) {
	return <ToastProvider>{children}</ToastProvider>;
}

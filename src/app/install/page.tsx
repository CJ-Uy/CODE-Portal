import { redirect } from "next/navigation";

// The install guide moved into the portal. Links already shared, and the first launch email, still land on it.
export default async function InstallRedirect({ searchParams }: { searchParams: Promise<{ os?: string }> }) {
	const { os } = await searchParams;
	redirect(os === "ios" || os === "android" ? `/portal/guides/install?os=${os}` : "/portal/guides/install");
}

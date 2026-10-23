import { redirect } from "next/navigation";

// Sidebar pins became important links with Show in sidebar on; keep old bookmarks working.
export default function NavPinsAdminPage() {
	redirect("/portal/admin/content/important-links");
}

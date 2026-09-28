import { AdminGroupIndex } from "../group-index";

export const dynamic = "force-dynamic";

export default function SystemGroupPage() {
	return <AdminGroupIndex segment="system" whoFor="Configure navigation and review admin activity" />;
}

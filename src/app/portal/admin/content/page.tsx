import { AdminGroupIndex } from "../group-index";

export const dynamic = "force-dynamic";

export default function ContentGroupPage() {
	return <AdminGroupIndex segment="content" whoFor="Publish and moderate what members and the public see" />;
}

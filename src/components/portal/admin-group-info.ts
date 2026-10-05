import { CalendarCheck, FileText, Mail, Settings2, Users } from "lucide-react";

export const adminGroupInfo = {
	members: { icon: Users, description: "Manage membership, admin access and school years." },
	content: { icon: FileText, description: "Publish updates, manage resources and review submissions." },
	email: { icon: Mail, description: "Write to members, read replies and manage senders." },
	data: { icon: CalendarCheck, description: "Review attendance, record points and export records." },
	system: { icon: Settings2, description: "Set up portal navigation and review admin activity." },
};

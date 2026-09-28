import { asc, desc, inArray } from "drizzle-orm";
import { Download } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { crsEvents, members, terms } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

export default async function ReportingAdminPage() {
	const actor = await requireActor();
	if (!can(actor, "retention:record")) redirect("/portal/admin");
	const db = getDb();
	const [termList, eventList, memberList] = await Promise.all([
		db.select().from(terms).orderBy(asc(terms.startsAt)),
		db.select().from(crsEvents).orderBy(desc(crsEvents.startsAt)).limit(50),
		db
			.select()
			.from(members)
			.where(inArray(members.status, ["active", "pending"]))
			.orderBy(asc(members.email))
			.limit(500),
	]);

	return (
		<div className="grid gap-6 lg:grid-cols-3">
			<ExportCard title="Whole-year master" description="Every retention record in a school year, one row per record.">
				<input type="hidden" name="kind" value="term" />
				<Select name="termId" required>
					{termList.map((term) => (
						<option key={term.id} value={term.id}>
							{term.name}
						</option>
					))}
				</Select>
			</ExportCard>

			<ExportCard title="Per-event roster" description="Who signed up and who was scanned in, per event.">
				<input type="hidden" name="kind" value="event" />
				<Select name="eventId" required>
					{eventList.map((event) => (
						<option key={event.id} value={event.id}>
							{event.title}
						</option>
					))}
				</Select>
			</ExportCard>

			<ExportCard title="Per-member history" description="One member's full-year retention history for a selected school year.">
				<input type="hidden" name="kind" value="member" />
				<Select name="termId" required>
					{termList.map((term) => (
						<option key={term.id} value={term.id}>
							{term.name}
						</option>
					))}
				</Select>
				<Select name="memberId" required>
					{memberList.map((member) => (
						<option key={member.id} value={member.id}>
							{member.fullName ?? member.name ?? member.email}
						</option>
					))}
				</Select>
			</ExportCard>
		</div>
	);
}

function ExportCard({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-3">
				<form action="/api/reporting/export" method="get" className="grid gap-3">
					{children}
					<Button type="submit" size="sm" variant="outline">
						<Download className="size-4" />
						Export xlsx
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}

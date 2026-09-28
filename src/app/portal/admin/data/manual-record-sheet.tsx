"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { RetentionForm } from "./retention/retention-form";
import type { EventOption } from "./retention/event-picker";
import type { MemberOption } from "./retention/member-checklist";

export function ManualRecordSheet({
	members,
	terms,
	events,
	pointTypes,
}: {
	members: MemberOption[];
	terms: { id: string; label: string }[];
	events: EventOption[];
	pointTypes: { id: string; key: string; label: string }[];
}) {
	return (
		<Sheet>
			<SheetTrigger asChild>
				<Button>
					<Plus className="size-4" />
					Add manual record
				</Button>
			</SheetTrigger>
			<SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
				<SheetHeader className="sticky top-0 z-20 border-b border-border bg-background px-5 py-4">
					<SheetTitle className="font-heading text-2xl">Add manual record</SheetTitle>
					<SheetDescription>
						Add points, deductions, or a non-scan attendance note for one or more members.
					</SheetDescription>
				</SheetHeader>
				<div className="px-5 pb-8">
					<RetentionForm
						members={members}
						termOptions={terms}
						eventOptions={events}
						pointTypeOptions={pointTypes}
					/>
				</div>
			</SheetContent>
		</Sheet>
	);
}

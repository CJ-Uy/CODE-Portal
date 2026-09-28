"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { recordRetentionAction, type RecordRetentionResult } from "./actions";
import { EventPicker, type EventOption } from "./event-picker";
import { MemberChecklist, type MemberOption } from "./member-checklist";

type Option = { id: string; label: string };
type PointTypeOption = { id: string; key: string; label: string };

export function RetentionForm({
	members,
	termOptions,
	eventOptions,
	pointTypeOptions,
}: {
	members: MemberOption[];
	termOptions: Option[];
	eventOptions: EventOption[];
	pointTypeOptions: PointTypeOption[];
}) {
	const [state, formAction, pending] = useActionState<RecordRetentionResult | null, FormData>(
		recordRetentionAction,
		null,
	);

	return (
		<form action={formAction} className="grid gap-6">
			<fieldset className="grid gap-2">
				<legend className="text-sm font-medium">Members</legend>
				<MemberChecklist members={members} />
			</fieldset>

			<label className="grid gap-2 text-sm font-medium">
				School year
				<Select name="termId" defaultValue={termOptions[0]?.id ?? ""} required>
					{termOptions.map((term) => (
						<option key={term.id} value={term.id}>
							{term.label}
						</option>
					))}
				</Select>
			</label>

			<label className="grid gap-2 text-sm font-medium">
				Point type
				<Select
					name="pointTypeId"
					defaultValue={pointTypeOptions.find((option) => option.key === "retention")?.id ?? ""}
					required
				>
					{pointTypeOptions.map((option) => (
						<option key={option.id} value={option.id}>
							{option.label}
						</option>
					))}
				</Select>
			</label>

			<fieldset className="grid gap-2">
				<legend className="text-sm font-medium">Event (optional)</legend>
				<EventPicker events={eventOptions} />
			</fieldset>

			<label className="grid gap-2 text-sm font-medium">
				Points (optional, may be negative)
				<Input name="points" type="number" inputMode="decimal" step="0.01" placeholder="Leave blank for none" />
			</label>

			<label className="grid gap-2 text-sm font-medium">
				Reason
				<Textarea name="reason" required maxLength={500} placeholder="Submitted the required medical waiver" />
			</label>

			{state && !state.ok ? <p className="text-sm text-destructive">{state.error}</p> : null}
			{state && state.ok ? (
				<p className="text-sm text-emerald-600">Recorded {state.count} retention record(s).</p>
			) : null}

			<div>
				<Button type="submit" disabled={pending}>
					{pending ? "Adding..." : "Add manual record"}
				</Button>
			</div>
		</form>
	);
}

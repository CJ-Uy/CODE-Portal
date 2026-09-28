"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { EventSignupField, EventSignupFieldType } from "@/lib/event-signup-form";

const FIELD_TYPES: Array<{ value: EventSignupFieldType; label: string }> = [
	// Label only — the stored key stays "radio" so existing rsvp_form_json blobs keep parsing.
	{ value: "radio", label: "Multiple choice" },
	{ value: "select", label: "Select" },
	{ value: "short_text", label: "Short answer" },
	{ value: "long_text", label: "Long answer" },
];

function newField(): EventSignupField {
	const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `field_${Date.now()}`;
	return { id, type: "radio", label: "", required: true, options: ["Participant", "Observer"] };
}

export function EventSignupFormEditor({
	value,
	onChange,
}: {
	value: EventSignupField[];
	onChange: (fields: EventSignupField[]) => void;
}) {
	function update(index: number, patch: Partial<EventSignupField>) {
		onChange(value.map((field, i) => (i === index ? { ...field, ...patch } : field)));
	}

	return (
		<div className="grid gap-3 rounded-lg border border-dashed border-border p-3">
			<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p className="text-sm font-medium">Signup form</p>
					<p className="text-xs text-muted-foreground">Optional questions members answer when they say they are going.</p>
				</div>
				<Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => onChange([...value, newField()])}>
					<Plus />
					Add field
				</Button>
			</div>

			{value.length === 0 ? (
				<p className="text-sm text-muted-foreground">No signup questions. Members can still mark themselves going.</p>
			) : (
				<ol className="grid gap-3">
					{value.map((field, index) => {
						const hasOptions = field.type === "radio" || field.type === "select";
						return (
							<li key={field.id} className="grid gap-3 rounded-md border border-border p-3">
								<div className="grid gap-3 sm:grid-cols-[140px_1fr_auto]">
									<label className="grid gap-1 text-sm font-medium">
										Type
										<Select value={field.type} onChange={(e) => update(index, { type: e.target.value as EventSignupFieldType })}>
											{FIELD_TYPES.map((type) => (
												<option key={type.value} value={type.value}>{type.label}</option>
											))}
										</Select>
									</label>
									<label className="grid gap-1 text-sm font-medium">
										Question
										<Input value={field.label} maxLength={160} onChange={(e) => update(index, { label: e.target.value })} />
									</label>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="self-end text-muted-foreground hover:text-destructive"
										aria-label="Remove question"
										onClick={() => onChange(value.filter((_, i) => i !== index))}
									>
										<Trash2 />
									</Button>
								</div>
								<label className="flex items-center gap-2 text-sm font-medium">
									<input
										type="checkbox"
										checked={field.required}
										onChange={(e) => update(index, { required: e.target.checked })}
										className="size-4 accent-primary"
									/>
									Required
								</label>
								{hasOptions ? (
									<label className="grid gap-1 text-sm font-medium">
										Options
										<Textarea
											value={field.options.join("\n")}
											rows={3}
											onChange={(e) => update(index, { options: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean) })}
											placeholder="Participant&#10;Observer&#10;Other"
										/>
									</label>
								) : null}
							</li>
						);
					})}
				</ol>
			)}
		</div>
	);
}

"use client";

import { useActionState, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { updateProfileAction, type UpdateProfileResult } from "./actions";

export type ProfileFormValues = {
	fullName: string;
	nickname: string;
	pronouns: string;
	batch: string;
	birthday: string;
	birthdayPublic: boolean;
};

export function EditProfileForm({ values }: { values: ProfileFormValues }) {
	const [editing, setEditing] = useState(false);
	const formRef = useRef<HTMLFormElement>(null);
	const [state, formAction, pending] = useActionState<UpdateProfileResult | null, FormData>(
		async (prev, formData) => {
			const result = await updateProfileAction(prev, formData);
			if (result.ok) setEditing(false);
			return result;
		},
		null,
	);

	function cancel() {
		formRef.current?.reset();
		setEditing(false);
	}

	return (
		<form ref={formRef} action={formAction} className="grid gap-5">
			<div className="flex items-start justify-between gap-3">
				<p className="text-sm text-muted-foreground">
					{editing ? "Update your details, then save." : "These details are used across the portal."}
				</p>
				{editing ? null : (
					<Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
						<Pencil />
						Edit
					</Button>
				)}
			</div>

			{/* ponytail: one disabled fieldset instead of a disabled prop per field. */}
			<fieldset disabled={!editing || pending} className="grid gap-5 sm:grid-cols-2">
				<Field label="Full name" name="fullName" defaultValue={values.fullName} editing={editing} />
				<Field label="Nickname" name="nickname" defaultValue={values.nickname} editing={editing} />
				<Field label="Pronouns" name="pronouns" defaultValue={values.pronouns} editing={editing} />
				<Field label="Batch" name="batch" defaultValue={values.batch} editing={editing} />
				<Field label="Birthday" name="birthday" type="date" defaultValue={values.birthday} editing={editing} />
				<label className="flex gap-3 self-end pb-2 text-sm font-medium">
					<Checkbox defaultChecked={values.birthdayPublic} name="birthdayPublic" className="mt-0.5" />
					<span className="grid gap-1">
						Show my birthday
						<span className="text-xs font-normal text-muted-foreground">
							Adds a Birthday event to the org calendar each year. Uncheck to keep it hidden.
						</span>
					</span>
				</label>
			</fieldset>

			{state && !state.ok ? (
				<p role="alert" className="text-sm text-destructive">
					{state.error}
				</p>
			) : null}
			{state?.ok && !editing ? (
				<p className="flex items-center gap-2 text-sm text-emerald-600">
					<Check className="size-4" />
					Profile saved.
				</p>
			) : null}

			{editing ? (
				<div className="flex gap-2">
					<Button type="submit" disabled={pending}>
						{pending ? "Saving..." : "Save"}
					</Button>
					<Button type="button" variant="ghost" onClick={cancel} disabled={pending}>
						<X />
						Cancel
					</Button>
				</div>
			) : null}
		</form>
	);
}

function Field({
	label,
	name,
	defaultValue,
	editing,
	type = "text",
}: {
	label: string;
	name: string;
	defaultValue: string;
	editing: boolean;
	type?: string;
}) {
	return (
		<label className="grid gap-2 text-sm font-medium">
			<span className="text-muted-foreground">{label}</span>
			<Input
				defaultValue={defaultValue}
				name={name}
				type={type}
				placeholder={editing ? undefined : "—"}
				className={cn(
					!editing &&
						"disabled:cursor-default disabled:border-transparent disabled:bg-muted/50 disabled:text-foreground disabled:opacity-100",
				)}
			/>
		</label>
	);
}

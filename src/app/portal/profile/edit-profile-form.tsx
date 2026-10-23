"use client";

import { useActionState, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { updateProfileAction, type UpdateProfileResult } from "./actions";

const BIRTHDAY = new Intl.DateTimeFormat("en", { timeZone: "UTC", month: "long", day: "numeric" });

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
			{editing ? (
				<fieldset disabled={pending} className="grid gap-5 sm:grid-cols-2">
					<Field label="Full name" name="fullName" defaultValue={values.fullName} />
					<Field label="Nickname" name="nickname" defaultValue={values.nickname} />
					<Field label="Pronouns" name="pronouns" defaultValue={values.pronouns} />
					<Field label="Batch" name="batch" defaultValue={values.batch} />
					<Field label="Birthday" name="birthday" type="date" defaultValue={values.birthday} />
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
			) : (
				<div className="grid gap-4">
					<dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
						<Detail label="Full name" value={values.fullName} />
						<Detail label="Nickname" value={values.nickname} />
						<Detail label="Pronouns" value={values.pronouns} />
						<Detail label="Batch" value={values.batch} />
						<Detail
							label="Birthday"
							value={values.birthday ? `${BIRTHDAY.format(new Date(`${values.birthday}T00:00:00Z`))}${values.birthdayPublic ? ", on the calendar" : ", hidden"}` : ""}
						/>
					</dl>
					<Button type="button" variant="outline" size="sm" className="min-h-11 w-fit sm:min-h-9" onClick={() => setEditing(true)}>
						<Pencil />
						Edit details
					</Button>
				</div>
			)}

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

function Field({ label, name, defaultValue, type = "text" }: { label: string; name: string; defaultValue: string; type?: string }) {
	return (
		<label className="grid gap-2 text-sm font-medium">
			<span className="text-muted-foreground">{label}</span>
			<Input defaultValue={defaultValue} name={name} type={type} />
		</label>
	);
}

function Detail({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<dt className="text-sm text-muted-foreground">{label}</dt>
			<dd className={value ? "mt-0.5 [overflow-wrap:anywhere]" : "mt-0.5 text-muted-foreground"}>{value || "Not set"}</dd>
		</div>
	);
}

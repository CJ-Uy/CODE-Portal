"use client";

import { useActionState } from "react";
import { CalendarRange, Plus, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { TermAdminRow } from "@/db/repositories/retention";
import { toLocalDate } from "@/lib/date-slots";
import { semesterBoundary } from "@/lib/retention-parts";
import { upsertTermAction } from "./actions";

function TermFields({ row }: { row?: TermAdminRow }) {
	return (
		<>
			<label className="grid gap-1.5 text-sm">
				<span className="font-medium">Name</span>
				<Input name="name" required maxLength={80} defaultValue={row?.name} placeholder="SY 2026-2027" />
			</label>
			<div className="grid gap-4 sm:grid-cols-2">
				<label className="grid gap-1.5 text-sm">
					<span className="font-medium">First day</span>
					<Input type="date" name="startsOn" required defaultValue={row && toLocalDate(row.startsAt)} />
				</label>
				<label className="grid gap-1.5 text-sm">
					<span className="font-medium">Last day</span>
					<Input type="date" name="endsOn" required defaultValue={row && toLocalDate(row.endsAt)} />
					<span className="text-xs text-muted-foreground">Inclusive: the year runs to 11:59 PM on this day.</span>
				</label>
			</div>
			<label className="grid gap-1.5 text-sm sm:max-w-[calc(50%-0.5rem)]">
				<span className="font-medium">2nd semester starts</span>
				<Input type="date" name="secondSemesterStartsOn" required defaultValue={row && toLocalDate(semesterBoundary(row))} />
				<span className="text-xs text-muted-foreground">
					Semestral retention parts need 1 point before this day and 1 point from this day on. Intersession counts as the 1st semester.
				</span>
			</label>
		</>
	);
}

function TermForm({ row }: { row?: TermAdminRow }) {
	const [state, formAction, pending] = useActionState(upsertTermAction, null);
	return (
		<form action={formAction} className="grid gap-4">
			<input type="hidden" name="id" value={row?.id ?? ""} />
			<TermFields row={row} />
			{state?.error ? (
				<p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{state.error}
				</p>
			) : null}
			<div>
				<Button type="submit" disabled={pending}>
					{row ? <Save /> : <Plus />}
					{row ? "Save changes" : "Add school year"}
				</Button>
			</div>
		</form>
	);
}

export function SchoolYearsManager({ rows }: { rows: TermAdminRow[] }) {
	const hasCurrent = rows.some((row) => row.isCurrent);
	return (
		<div className="grid gap-6">
			{hasCurrent ? null : (
				<p
					role="status"
					className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
				>
					No school year covers today, so check-ins and points cannot be recorded. Add one whose dates include today.
				</p>
			)}

			<Card>
				<CardHeader>
					<CardTitle>School years</CardTitle>
					<CardDescription>
						Attendance and points attach to the school year covering the day they happen. Dates cannot overlap, and
						school years are never deleted here: removing one would erase every scan and point recorded against it.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{rows.length === 0 ? (
						<p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
							No school years yet. Add the first one below.
						</p>
					) : (
						<ul className="grid gap-4">
							{rows.map((row) => (
								<li key={row.id} className="grid gap-4 rounded-lg border border-border p-4">
									<div className="flex min-w-0 flex-wrap items-center gap-2">
										<CalendarRange className="size-4 shrink-0 text-muted-foreground" aria-hidden />
										<p className="min-w-0 break-all font-semibold">{row.name}</p>
										{row.isCurrent ? <Badge variant="success">Current</Badge> : null}
									</div>
									<TermForm row={row} />
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Add school year</CardTitle>
					<CardDescription>Set the span and when the 2nd semester starts. Retention parts are measured against these dates.</CardDescription>
				</CardHeader>
				<CardContent>
					<TermForm />
				</CardContent>
			</Card>
		</div>
	);
}

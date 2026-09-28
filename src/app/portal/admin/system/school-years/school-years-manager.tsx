"use client";

import { useActionState } from "react";
import { CalendarRange, Plus, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { TermAdminRow } from "@/db/repositories/retention";
import { toLocalDate } from "@/lib/date-slots";
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
					<span className="text-xs text-muted-foreground">Inclusive — the year runs to 11:59 PM on this day.</span>
				</label>
			</div>
			<div className="grid gap-4 sm:grid-cols-2">
				<label className="grid gap-1.5 text-sm">
					<span className="font-medium">Retained at</span>
					<Input type="number" inputMode="numeric" name="retainedAt" required min={0} max={100000} defaultValue={row?.retainedAt ?? 20} />
					<span className="text-xs text-muted-foreground">Points that count a member as retained.</span>
				</label>
				<label className="grid gap-1.5 text-sm">
					<span className="font-medium">Probation below</span>
					<Input
						type="number"
						inputMode="numeric"
						name="probationBelow"
						required
						min={0}
						max={100000}
						defaultValue={row?.probationBelow ?? 10}
					/>
					<span className="text-xs text-muted-foreground">Under this total, a member is on probation.</span>
				</label>
			</div>
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
						school years are never deleted here — removing one would erase every scan and point recorded against it.
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
					<CardDescription>Set the span and the point thresholds members are measured against.</CardDescription>
				</CardHeader>
				<CardContent>
					<TermForm />
				</CardContent>
			</Card>
		</div>
	);
}

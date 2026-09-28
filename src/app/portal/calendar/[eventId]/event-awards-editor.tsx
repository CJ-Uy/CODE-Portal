"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { AwardEditorRow } from "./award-editor-input";
import { parseActiveAwardValues } from "./award-editor-input";
import { removeRetiredAwardAction, setAwardsAction } from "./actions";

export function EventAwardsEditor({
	eventId,
	rows,
	unavailable,
}: {
	eventId: string;
	rows: AwardEditorRow[];
	unavailable: boolean;
}) {
	const router = useRouter();
	const [values, setValues] = useState<Record<string, string>>(() =>
		Object.fromEntries(rows.filter((row) => !row.retired).map((row) => [row.pointTypeId, row.value])),
	);
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<string | null>(null);
	const [pointTypeId, setPointTypeId] = useState("");
	const [points, setPoints] = useState("");

	const activeRows = rows.filter((row) => !row.retired);
	const allocatedRows = activeRows.filter((row) => values[row.pointTypeId]?.trim());
	const availableRows = activeRows.filter((row) => !values[row.pointTypeId]?.trim());

	function save(nextValues: Record<string, string>, message: string, onSaved?: () => void) {
		setError(null);
		setResult(null);
		startTransition(async () => {
			try {
				const saved = await setAwardsAction(eventId, parseActiveAwardValues(rows, nextValues));
				setValues(nextValues);
				setResult(`${message} Updated ${saved.updated} attendee record(s).`);
				onSaved?.();
				router.refresh();
			} catch (error) {
				setError(error instanceof Error ? error.message : "Could not update event awards.");
			}
		});
	}

	function addAllocation() {
		const row = activeRows.find((row) => row.pointTypeId === pointTypeId);
		if (!row) {
			setError("Select a point type.");
			return;
		}
		if (!points.trim()) {
			setError("Enter how many points to allocate.");
			return;
		}
		save({ ...values, [row.pointTypeId]: points }, "Point allocation saved.", () => {
			setPointTypeId("");
			setPoints("");
		});
	}

	function removeAllocation(row: AwardEditorRow) {
		if (!window.confirm(`Remove the ${row.label} allocation? This also updates checked-in attendees.`)) return;
		save({ ...values, [row.pointTypeId]: "" }, "Point allocation removed.");
	}

	function removeRetired(pointTypeId: string) {
		setError(null);
		setResult(null);
		startTransition(async () => {
			try {
				await removeRetiredAwardAction(eventId, pointTypeId);
				setResult("Retired point allocation removed.");
				router.refresh();
			} catch (error) {
				setError(error instanceof Error ? error.message : "Could not remove the retired award.");
			}
		});
	}

	if (unavailable) {
		return (
			<p className="rounded-lg border border-dashed border-border bg-secondary/40 px-3 py-2 text-sm text-destructive">
				Event awards are unavailable right now. Try again shortly.
			</p>
		);
	}

	return (
		<div className="grid min-w-0 gap-5">
			<p className="text-sm text-muted-foreground">
				Each checked-in attendee receives every allocation listed here. Changes also update past check-ins.
			</p>

			<section className="grid gap-2" aria-labelledby="current-point-allocations">
				<div className="flex items-center justify-between gap-3">
					<h3 id="current-point-allocations" className="text-sm font-semibold">
						Point allocations
					</h3>
					<span className="text-xs text-muted-foreground">{allocatedRows.length} active</span>
				</div>
				{allocatedRows.length === 0 && rows.every((row) => !row.retired) ? (
					<p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
						No points have been allocated yet.
					</p>
				) : (
					<ul className="divide-y divide-border rounded-lg border border-border">
						{allocatedRows.map((row) => {
							const value = values[row.pointTypeId];
							return (
								<li key={row.pointTypeId} className="flex min-w-0 items-center gap-3 px-3 py-2.5">
									<span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
										<Coins className="size-4" />
									</span>
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium">{row.label}</p>
										<p className="text-xs text-muted-foreground">
											{value} {value === "1" || value === "-1" ? "point" : "points"} per attendee
										</p>
									</div>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="text-muted-foreground hover:text-white focus-visible:text-white"
										aria-label={`Remove ${row.label} allocation`}
										onClick={() => removeAllocation(row)}
										disabled={pending}
									>
										<Trash2 />
									</Button>
								</li>
							);
						})}
						{rows.filter((row) => row.retired).map((row) => (
							<li key={row.pointTypeId} className="flex min-w-0 items-center gap-3 px-3 py-2.5">
								<span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
									<Coins className="size-4" />
								</span>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium">{row.label}</p>
									<p className="text-xs text-muted-foreground">Retired type, previously {row.value} points</p>
								</div>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="text-muted-foreground hover:text-white focus-visible:text-white"
									aria-label={`Remove retired ${row.label} allocation`}
									onClick={() => removeRetired(row.pointTypeId)}
									disabled={pending}
								>
									<Trash2 />
								</Button>
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="grid gap-3 rounded-lg border border-dashed border-border bg-secondary/20 p-3 sm:p-4" aria-labelledby="add-point-allocation">
				<div className="flex items-center gap-2">
					<Plus className="size-4 text-accent" />
					<h3 id="add-point-allocation" className="text-sm font-semibold">Add point allocation</h3>
				</div>
				<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
					<label className="grid min-w-0 gap-1.5 text-sm">
						<span className="font-medium">Point type</span>
						<Select value={pointTypeId} onChange={(event) => setPointTypeId(event.target.value)} disabled={pending || availableRows.length === 0}>
							<option value="">{availableRows.length === 0 ? "All types allocated" : "Select point type"}</option>
							{availableRows.map((row) => <option key={row.pointTypeId} value={row.pointTypeId}>{row.label}</option>)}
						</Select>
					</label>
					<label className="grid gap-1.5 text-sm">
						<span className="font-medium">Points</span>
						<Input
							type="number"
							min={-100}
							max={100}
							step={0.01}
							inputMode="decimal"
							value={points}
							placeholder="e.g. 0.75"
							onChange={(event) => setPoints(event.target.value)}
							disabled={pending || availableRows.length === 0}
						/>
					</label>
					<Button type="button" onClick={addAllocation} disabled={pending || availableRows.length === 0}>
						<Save />
						{pending ? "Saving..." : "Save allocation"}
					</Button>
				</div>
			</section>

			<div aria-live="polite">
				{result ? <p className="text-sm text-accent">{result}</p> : null}
				{error ? <p className="text-sm text-destructive">{error}</p> : null}
			</div>
		</div>
	);
}

"use client";

import { useOptimistic, useTransition } from "react";
import { Lock } from "lucide-react";
import type { PreferenceRow } from "@/db/repositories/email-member";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { setOptOutAction } from "../actions";

function Switch({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange?: (next: boolean) => void; label: string }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange?.(!checked)}
			className={cn(
				"relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed",
				checked ? "bg-primary" : "bg-[#AAAFB5]",
				disabled && "opacity-60",
			)}
		>
			<span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform duration-200 motion-reduce:transition-none", checked ? "translate-x-5" : "translate-x-0.5")} />
		</button>
	);
}

export function PreferencesList({ rows }: { rows: PreferenceRow[] }) {
	const toast = useToast();
	const [, startTransition] = useTransition();
	const [optimistic, setOptimistic] = useOptimistic(rows, (current, change: { id: string; optedOut: boolean }) =>
		current.map((r) => (r.id === change.id ? { ...r, optedOut: change.optedOut } : r)),
	);
	const required = optimistic.filter((r) => r.required);
	const optional = optimistic.filter((r) => !r.required);

	// Undo re-enters toggle, so a failed undo surfaces its own error toast.
	const toggle = (row: PreferenceRow, optedOut: boolean) =>
		startTransition(async () => {
			setOptimistic({ id: row.id, optedOut });
			const result = await setOptOutAction(row.id, optedOut);
			if (!result.ok) return toast({ message: result.error });
			toast({
				message: optedOut ? `${row.name} turned off.` : `${row.name} turned on.`,
				action: { label: "Undo", onClick: () => toggle(row, !optedOut) },
			});
		});

	if (optimistic.length === 0) return <p className="text-sm text-muted-foreground">There are no email categories yet.</p>;

	return (
		<div className="grid gap-5">
			{required.length > 0 ? (
				<section className="grid gap-2">
					<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Always sent to members</h2>
					<ul className="grid divide-y divide-border rounded-xl border border-border bg-card">
						{required.map((row) => (
							<li key={row.id} className="flex min-w-0 items-center gap-4 px-4 py-3">
								<div className="grid min-w-0 flex-1 gap-0.5">
									<span className="flex min-w-0 items-center gap-1.5 font-medium">
										<Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
										<span className="min-w-0 break-all">{row.name}</span>
									</span>
									<span className="min-w-0 break-all text-sm text-muted-foreground">{row.description || "Official notices for members."} Required while you are a member.</span>
								</div>
								<Switch checked disabled label={`${row.name} is required`} />
							</li>
						))}
					</ul>
				</section>
			) : null}
			{optional.length > 0 ? (
				<section className="grid gap-2">
					<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">You choose</h2>
					<ul className="grid divide-y divide-border rounded-xl border border-border bg-card">
						{optional.map((row) => (
							<li key={row.id} className="flex min-w-0 items-center gap-4 px-4 py-3">
								<div className="grid min-w-0 flex-1 gap-0.5">
									<span className="min-w-0 break-all font-medium">{row.name}</span>
									{row.description ? <span className="min-w-0 break-all text-sm text-muted-foreground">{row.description}</span> : null}
								</div>
								<Switch checked={!row.optedOut} onChange={(on) => toggle(row, !on)} label={row.name} />
							</li>
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}

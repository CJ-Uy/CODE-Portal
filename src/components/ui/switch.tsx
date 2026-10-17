"use client";

import { cn } from "@/lib/utils";

/** An on/off switch. Name it with `labelledBy` (the id of its visible label). */
export function Switch({ checked, disabled, onChange, labelledBy, describedBy }: { checked: boolean; disabled?: boolean; onChange: (next: boolean) => void; labelledBy: string; describedBy?: string }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-labelledby={labelledBy}
			aria-describedby={describedBy}
			disabled={disabled}
			onClick={() => onChange(!checked)}
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

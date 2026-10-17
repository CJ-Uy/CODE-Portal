"use client";

import { useEffect, useRef } from "react";

/** A native modal dialog driven by `open`. Esc and a tap on the backdrop close it unless `locked`. */
export function Modal({
	open,
	onOpenChange,
	locked = false,
	labelledBy,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	locked?: boolean;
	labelledBy: string;
	children: React.ReactNode;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	}, [open]);
	return (
		<dialog
			ref={ref}
			aria-labelledby={labelledBy}
			onClose={() => onOpenChange(false)}
			onCancel={(event) => {
				if (locked) event.preventDefault();
			}}
			// A tap on the backdrop lands on the dialog element itself, not on its content.
			onClick={(event) => {
				if (!locked && event.target === event.currentTarget) onOpenChange(false);
			}}
			className="email-dialog m-auto w-[min(92vw,30rem)] rounded-xl border border-border bg-card p-0 text-card-foreground shadow-xl"
		>
			{children}
		</dialog>
	);
}

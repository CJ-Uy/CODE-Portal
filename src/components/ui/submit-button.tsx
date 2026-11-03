"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { pendingLabel } from "@/lib/pending-label";
import { cn } from "@/lib/utils";

/** Rewrites the first text child that starts with a known verb. Icons and other elements pass through. */
function withPendingLabel(children: React.ReactNode): React.ReactNode {
	let seenText = false;
	return React.Children.map(children, (child) => {
		if (seenText || typeof child !== "string" || !child.trim()) return child;
		seenText = true;
		return pendingLabel(child) ?? child;
	});
}

/**
 * Button renders every `type="submit"` through this, so a form that posts to a server action shows
 * progress without wiring its own state. While the action runs, every submit button in the form is
 * disabled, and the one that was pressed swaps its icon for a spinner and its verb for "…ing". A
 * redirecting action keeps it pending until the next page paints, because the action's transition
 * holds until then. Forms that submit through onSubmit and their own transition are untouched.
 */
export const SubmitButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
	function SubmitButton({ children, className, disabled, ...props }, ref) {
		const { pending, action } = useFormStatus();
		// A button with its own formAction only claims the action it started.
		const mine = pending && (typeof props.formAction !== "function" || action === props.formAction);
		return (
			<button
				ref={ref}
				{...props}
				disabled={disabled || pending}
				aria-busy={mine || undefined}
				className={cn(className, mine && "[&>svg]:hidden")}
			>
				{mine ? (
					<span className="contents" aria-hidden>
						<LoaderCircle className="animate-spin motion-reduce:animate-none" />
					</span>
				) : null}
				{mine ? withPendingLabel(children) : children}
			</button>
		);
	},
);

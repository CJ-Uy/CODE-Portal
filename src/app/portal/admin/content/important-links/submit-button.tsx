"use client";

import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";

/** A form's submit button that disables itself and swaps its icon for a spinner while the action runs. */
export function SubmitButton({ icon, children, disabled, ...props }: ButtonProps & { icon?: React.ReactNode }) {
	const { pending } = useFormStatus();
	return (
		<Button type="submit" disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
			{pending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : icon}
			{children}
		</Button>
	);
}

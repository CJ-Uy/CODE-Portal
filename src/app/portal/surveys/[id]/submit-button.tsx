"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

// Disabled while sending, so a double tap cannot submit twice, and the label says something is happening.
export function SubmitButton() {
	const { pending } = useFormStatus();
	return (
		<Button type="submit" disabled={pending} aria-busy={pending} className="h-12 w-full sm:ml-auto sm:w-auto">
			{pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Send />}
			{pending ? "Sending..." : "Send feedback"}
		</Button>
	);
}

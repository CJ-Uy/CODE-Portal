"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { type RunningResult, updateRunningAction } from "../actions";

/**
 * Whether the event's organizers can see these results. Unlike the rest of the manage panel this works on a closed form
 * too, so it lives apart from it: an admin can stop sharing at any time after the form has been sent.
 */
export function ShareToggle({ surveyId, shared }: { surveyId: string; shared: boolean }) {
	const [result, formAction, pending] = useActionState<RunningResult, FormData>(updateRunningAction, null);

	return (
		<form action={formAction} className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-4">
			<input type="hidden" name="surveyId" value={surveyId} />
			<input type="hidden" name="intent" value="share" />
			<input type="hidden" name="shareWithOrganizers" value={shared ? "0" : "1"} />
			<p className="min-w-0 text-sm">{shared ? "Organizers can see these results." : "Organizers can't see these results."}</p>
			<Button type="submit" variant="outline" size="sm" disabled={pending}>
				{shared ? "Stop sharing" : "Share with organizers"}
			</Button>
			{result && "error" in result ? (
				<p role="alert" className="min-w-0 basis-full text-sm text-destructive">
					{result.error}
				</p>
			) : null}
		</form>
	);
}

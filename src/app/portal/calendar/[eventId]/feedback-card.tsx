import Link from "next/link";
import { CheckCircle2, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Walk-in entry to the feedback form. Takes plain values only, never the survey row. */
export function FeedbackCard({ surveyId, state }: { surveyId: string; state: "open" | "answered" }) {
	if (state === "answered") {
		return (
			<Card>
				<CardContent className="flex items-center gap-3 p-4">
					<CheckCircle2 className="size-5 shrink-0 text-accent" />
					<p className="text-sm font-medium">Thanks, feedback sent.</p>
				</CardContent>
			</Card>
		);
	}
	return (
		<Card>
			<CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-start gap-3">
					<MessageSquareText className="mt-0.5 size-5 shrink-0 text-accent" />
					<div className="min-w-0">
						<p className="text-sm font-semibold">Share feedback</p>
						<p className="text-sm text-muted-foreground">A few quick questions about this event.</p>
					</div>
				</div>
				<Button asChild className="w-full sm:w-auto">
					<Link href={`/portal/surveys/${encodeURIComponent(surveyId)}`}>Open the form</Link>
				</Button>
			</CardContent>
		</Card>
	);
}

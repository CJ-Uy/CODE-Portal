import Link from "next/link";
import { ArrowRight, CheckCircle2, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatUtc8DateTime } from "@/lib/date-slots";

/** Walk-in entry to the feedback form. Takes plain values only, never the survey row. */
export function FeedbackCard({ surveyId, state, closesAt }: { surveyId: string; state: "open" | "answered"; closesAt: Date | null }) {
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
		<Card className="border-accent/40">
			<CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-start gap-3">
					<MessageSquareText className="mt-0.5 size-5 shrink-0 text-accent" />
					<div className="min-w-0">
						<p className="text-sm font-semibold">How was this event?</p>
						<p className="text-sm text-muted-foreground">
							A few quick questions.{closesAt ? ` Open until ${formatUtc8DateTime(closesAt)}.` : ""}
						</p>
					</div>
				</div>
				<Button asChild className="w-full sm:w-auto">
					<Link href={`/portal/surveys/${encodeURIComponent(surveyId)}`}>
						Give feedback
						<ArrowRight />
					</Link>
				</Button>
			</CardContent>
		</Card>
	);
}

"use client";

import { useState } from "react";
import { CheckCircle2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function ArticleFeedback({ slug }: { slug: string }) {
	const [rating, setRating] = useState(0);
	const [hover, setHover] = useState(0);
	const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
	const [error, setError] = useState<string | null>(null);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (rating < 1) {
			setError("Pick a rating first.");
			return;
		}
		const comment = (new FormData(event.currentTarget).get("comment") as string | null)?.trim() || undefined;
		setStatus("sending");
		setError(null);
		const response = await fetch(`/api/articles/${slug}/feedback`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ rating, comment }),
		}).catch(() => null);
		if (response?.ok) {
			setStatus("sent");
			return;
		}
		setError("Could not record your feedback.");
		setStatus("error");
	}

	if (status === "sent") {
		return (
			<div className="flex items-center gap-3 rounded-2xl border border-border p-6">
				<CheckCircle2 className="size-6 text-accent" />
				<p className="text-sm font-medium">Thanks for the feedback.</p>
			</div>
		);
	}

	return (
		<form onSubmit={submit} className="grid gap-3 rounded-2xl border border-border p-6">
			<p className="font-heading text-lg">Was this helpful?</p>
			<div className="flex gap-1">
				{[1, 2, 3, 4, 5].map((value) => (
					<button
						key={value}
						type="button"
						aria-label={`${value} star${value > 1 ? "s" : ""}`}
						onClick={() => setRating(value)}
						onMouseEnter={() => setHover(value)}
						onMouseLeave={() => setHover(0)}
						className="p-0.5"
					>
						<Star className={cn("size-6 transition-colors", (hover || rating) >= value ? "fill-accent text-accent" : "text-border")} />
					</button>
				))}
			</div>
			<Textarea name="comment" rows={3} maxLength={1000} placeholder="Anything you'd add? (optional)" />
			{error ? <p className="text-sm text-destructive">{error}</p> : null}
			<div>
				<Button type="submit" variant="secondary" disabled={status === "sending"}>
					{status === "sending" ? "Sending…" : "Submit feedback"}
				</Button>
			</div>
		</form>
	);
}

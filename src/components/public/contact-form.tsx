"use client";

import { useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const SEGMENTS = [
	{ value: "within_ls", label: "Within the Loyola Schools" },
	{ value: "outside_ls", label: "Outside the Loyola Schools" },
	{ value: "not_sure", label: "Not sure" },
];

export function ContactForm() {
	const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
	const [error, setError] = useState<string | null>(null);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const data = new FormData(form);
		setStatus("sending");
		setError(null);
		const response = await fetch("/api/contact", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: data.get("name"),
				organization: data.get("organization"),
				email: data.get("email"),
				orgSegment: data.get("orgSegment"),
				message: data.get("message"),
			}),
		}).catch(() => null);
		if (response?.ok) {
			setStatus("sent");
			form.reset();
			return;
		}
		const body = (await response?.json().catch(() => null)) as { error?: string } | null;
		setError(body?.error ?? "Could not send your message. Please try again.");
		setStatus("error");
	}

	if (status === "sent") {
		return (
			<div className="flex flex-col items-center gap-3 rounded-2xl border border-border p-8 text-center">
				<CheckCircle2 className="size-10 text-accent" />
				<p className="font-heading text-xl">Message sent</p>
				<p className="text-sm text-muted-foreground">Thanks for reaching out. We will get back to you over email.</p>
				<Button variant="outline" size="sm" onClick={() => setStatus("idle")}>
					Send another
				</Button>
			</div>
		);
	}

	return (
		<form onSubmit={onSubmit} className="grid gap-4">
			<div className="grid gap-4 sm:grid-cols-2">
				<label className="grid gap-1.5 text-sm font-medium">
					Name
					<Input name="name" required maxLength={120} />
				</label>
				<label className="grid gap-1.5 text-sm font-medium">
					Organization
					<Input name="organization" required maxLength={160} />
				</label>
			</div>
			<label className="grid gap-1.5 text-sm font-medium">
				Email
				<Input name="email" type="email" required maxLength={200} />
			</label>
			<label className="grid gap-1.5 text-sm font-medium">
				Your organization is…
				<select name="orgSegment" required defaultValue="within_ls" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
					{SEGMENTS.map((segment) => (
						<option key={segment.value} value={segment.value}>
							{segment.label}
						</option>
					))}
				</select>
			</label>
			<label className="grid gap-1.5 text-sm font-medium">
				How can we help?
				<Textarea name="message" rows={5} required maxLength={2000} />
			</label>
			{error ? <p className="text-sm text-destructive">{error}</p> : null}
			<div>
				<Button type="submit" disabled={status === "sending"}>
					<Send />
					{status === "sending" ? "Sending…" : "Send message"}
				</Button>
			</div>
		</form>
	);
}

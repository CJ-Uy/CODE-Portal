"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Send, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { EventSignupAnswers, EventSignupField } from "@/lib/event-signup-form";
import { rsvpAction } from "./actions";

export function EventSignupPanel({
	eventId,
	form,
	initialState,
	initialAnswers,
}: {
	eventId: string;
	form: EventSignupField[];
	initialState: "going" | "none";
	initialAnswers: EventSignupAnswers;
}) {
	const router = useRouter();
	const [answers, setAnswers] = useState<EventSignupAnswers>(initialAnswers);
	const [state, setState] = useState(initialState);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const going = state === "going";

	function setAnswer(id: string, value: string) {
		setAnswers((current) => ({ ...current, [id]: value }));
	}

	function submit(nextState: "going" | "none") {
		setError(null);
		startTransition(async () => {
			try {
				await rsvpAction(eventId, nextState, nextState === "going" ? answers : {});
				setState(nextState);
				router.refresh();
			} catch (e) {
				setError(e instanceof Error ? e.message : "Could not save signup.");
			}
		});
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-3">
					<CardTitle className="text-base">Signup</CardTitle>
					<Badge variant={going ? "default" : "secondary"}>{going ? "Going" : "Not going"}</Badge>
				</div>
				<CardDescription>Tell the organizers if you plan to attend.</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4">
				{form.length > 0 ? (
					<div className="grid gap-3">
						{form.map((field) => (
							<label key={field.id} className="grid gap-1.5 text-sm">
								<span className="font-medium">
									{field.label}
									{field.required ? <span className="text-destructive"> *</span> : null}
								</span>
								{field.type === "long_text" ? (
									<Textarea value={answers[field.id] ?? ""} rows={3} onChange={(e) => setAnswer(field.id, e.target.value)} />
								) : field.type === "select" ? (
									<Select value={answers[field.id] ?? ""} onChange={(e) => setAnswer(field.id, e.target.value)}>
										<option value="">Select</option>
										{field.options.map((option) => <option key={option} value={option}>{option}</option>)}
									</Select>
								) : field.type === "radio" ? (
									<span className="grid gap-1.5">
										{field.options.map((option) => (
											<span key={option} className="flex items-center gap-2">
												<input
													type="radio"
													name={field.id}
													value={option}
													checked={answers[field.id] === option}
													onChange={() => setAnswer(field.id, option)}
													className="size-4 accent-primary"
												/>
												<span>{option}</span>
											</span>
										))}
									</span>
								) : (
									<Input value={answers[field.id] ?? ""} onChange={(e) => setAnswer(field.id, e.target.value)} />
								)}
							</label>
						))}
					</div>
				) : going ? (
					<p className="flex items-center gap-2 text-sm text-accent"><CheckCircle2 className="size-4" />You are signed up.</p>
				) : null}
				{error ? <p className="text-sm text-destructive">{error}</p> : null}
				<div className="flex flex-wrap gap-2">
					<Button type="button" onClick={() => submit("going")} disabled={pending}>
						<Send />
						{going ? "Update signup" : "Sign up"}
					</Button>
					{going ? (
						<Button type="button" variant="outline" onClick={() => submit("none")} disabled={pending}>
							<X />
							Cancel signup
						</Button>
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}

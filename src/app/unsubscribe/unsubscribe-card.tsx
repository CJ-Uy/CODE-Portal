"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { unsubscribeAction } from "./actions";

export function UnsubscribeCard({ token, categoryName, requiredNames, initiallyOut }: { token: string; categoryName: string; requiredNames: string[]; initiallyOut: boolean }) {
	const [out, setOut] = useState(initiallyOut);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const set = (next: boolean) =>
		startTransition(async () => {
			const result = await unsubscribeAction(token, next);
			if (!result.ok) return setError(result.error);
			setError(null);
			setOut(next);
		});

	return (
		<div className="toast-enter grid w-full max-w-[420px] gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
			<Image src="/code-logo-full-navy.png" alt="CODE" width={94} height={32} className="h-8 w-auto justify-self-start dark:hidden" />
			<Image src="/code-logo-full-white.png" alt="CODE" width={94} height={32} className="hidden h-8 w-auto justify-self-start dark:block" />
			{out ? (
				<>
					<div className="flex items-center gap-2">
						<span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
							<Check className="check-pop size-4" aria-hidden />
						</span>
						<h1 className="min-w-0 break-all font-heading text-2xl">You are unsubscribed from {categoryName}.</h1>
					</div>
					<Button variant="outline" onClick={() => set(false)} disabled={pending} className="justify-self-start">
						Undo
					</Button>
				</>
			) : (
				<>
					<h1 className="min-w-0 break-all font-heading text-2xl">Stop getting {categoryName} emails?</h1>
					<Button onClick={() => set(true)} disabled={pending} className="h-auto min-w-0 justify-self-start whitespace-normal break-all text-left">
						Unsubscribe from {categoryName}
					</Button>
				</>
			)}
			{error ? <p role="alert" className="text-sm text-[#343B41] dark:text-[#D7DFE9]">{error}</p> : null}
			{requiredNames.length > 0 ? (
				<p className="min-w-0 break-all text-sm text-muted-foreground">As a member you still get: {requiredNames.join(", ")}.</p>
			) : null}
			<Link href="/portal/mail/preferences" className="text-sm text-accent underline-offset-2 hover:underline">
				Manage all email preferences
			</Link>
		</div>
	);
}

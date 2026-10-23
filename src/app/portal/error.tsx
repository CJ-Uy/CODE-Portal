"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { House, RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Catches a failed portal page inside the shell, so the sidebar stays and the member is never
 * dropped on a blank error screen. Retry refetches the page from the server before resetting,
 * which is what a server-side failure needs. Navigating elsewhere clears it on its own.
 */
export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
	const router = useRouter();
	const [retrying, startRetry] = useTransition();

	return (
		<div role="alert" className="mx-auto grid max-w-md justify-items-center gap-4 py-16 text-center">
			<span className="grid size-12 place-items-center rounded-full bg-secondary text-accent">
				<TriangleAlert className="size-6" aria-hidden />
			</span>
			<div className="grid gap-2">
				<h1 className="font-heading text-2xl">This page did not load</h1>
				<p className="text-sm text-muted-foreground">
					Something went wrong on our side. If you were saving something, it may not have gone through, so check before you try again.
				</p>
			</div>
			<div className="flex flex-wrap justify-center gap-2">
				<Button
					type="button"
					disabled={retrying}
					onClick={() =>
						startRetry(() => {
							router.refresh();
							reset();
						})
					}
				>
					<RotateCw className={retrying ? "animate-spin motion-reduce:animate-none" : undefined} aria-hidden />
					{retrying ? "Trying again…" : "Try again"}
				</Button>
				<Button asChild variant="outline">
					<Link href="/portal">
						<House aria-hidden />
						Go to Home
					</Link>
				</Button>
			</div>
			{error.digest ? <p className="text-xs text-muted-foreground">Reference: {error.digest}</p> : null}
		</div>
	);
}

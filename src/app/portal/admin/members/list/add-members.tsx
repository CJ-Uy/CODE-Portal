"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseEmailColumn } from "@/lib/roster-emails";
import { bulkAddMembersAction, inviteMemberAction, type BulkAddResult } from "./actions";

export function AddMembers() {
	const router = useRouter();
	const [bulk, setBulk] = useState(false);
	const [email, setEmail] = useState("");
	const [raw, setRaw] = useState("");
	const [result, setResult] = useState<BulkAddResult | null>(null);
	const [oneAdded, setOneAdded] = useState(false);
	const [pending, startTransition] = useTransition();
	const preview = parseEmailColumn(raw);
	const overCap = preview.valid.length > 500;

	function submitOne(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		setOneAdded(false);
		startTransition(async () => {
			try {
				await inviteMemberAction(formData);
				setEmail("");
				setOneAdded(true);
				router.refresh();
			} catch (error) {
				window.alert(error instanceof Error ? error.message : "Could not add member.");
			}
		});
	}

	function submitBulk() {
		setResult(null);
		startTransition(async () => {
			try {
				const next = await bulkAddMembersAction({ raw });
				setResult(next);
				setRaw("");
			} catch (error) {
				window.alert(error instanceof Error ? error.message : "Bulk add failed.");
			}
		});
	}

	return (
		<div className="grid gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<Button type="button" size="sm" variant={!bulk ? "default" : "outline"} onClick={() => setBulk(false)}>
					Add one
				</Button>
				<Button type="button" size="sm" variant={bulk ? "default" : "outline"} onClick={() => setBulk(true)}>
					Add bulk
				</Button>
			</div>

			{bulk ? (
				<div className="grid gap-2 rounded-lg border border-dashed border-border p-3">
					<label className="text-sm font-medium" htmlFor="bulk-emails">
						Paste a column of emails
					</label>
					<Textarea
						id="bulk-emails"
						value={raw}
						onChange={(event) => setRaw(event.target.value)}
						rows={5}
						placeholder={"member1@example.com\nmember2@example.com"}
					/>
					<div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
						<span>
							{preview.valid.length} valid, {preview.dedupedInput} duplicate, {preview.invalid.length} invalid
						</span>
						<Button type="button" size="sm" onClick={submitBulk} disabled={pending || preview.valid.length === 0 || overCap}>
							Add {preview.valid.length}
						</Button>
						{overCap ? <span className="text-destructive">Max 500 emails per batch.</span> : null}
					</div>
					{preview.invalid.length > 0 ? (
						<details className="text-sm">
							<summary className="cursor-pointer text-muted-foreground">Show invalid emails</summary>
							<pre className="mt-1 overflow-x-auto rounded bg-secondary/40 p-2 text-xs">{preview.invalid.join("\n")}</pre>
						</details>
					) : null}
					{result ? <p className="text-sm text-foreground">Processed {result.processed} email(s).</p> : null}
				</div>
			) : (
				<form onSubmit={submitOne} className="flex flex-wrap items-center gap-2">
					<Input
						name="email"
						type="email"
						value={email}
						onChange={(event) => {
							setEmail(event.target.value);
							setOneAdded(false);
						}}
						placeholder="member@example.com"
						required
						disabled={pending}
						className="max-w-xs"
					/>
					<Button type="submit" disabled={pending} aria-label={pending ? "Adding member" : undefined}>
						{pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
						{pending ? "Adding…" : "Add one"}
					</Button>
					{oneAdded ? (
						<span role="status" className="inline-flex items-center gap-1 text-sm text-accent">
							<Check className="size-4" aria-hidden="true" /> Member added.
						</span>
					) : null}
				</form>
			)}
		</div>
	);
}

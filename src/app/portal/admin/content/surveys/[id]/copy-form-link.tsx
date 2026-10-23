"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The member form's address, for pasting into a group chat. Members still sign in and the server still checks who may
 * answer, so sharing the link opens nothing up. If the clipboard is blocked, the address is shown to copy by hand.
 */
export function CopyFormLink({ surveyId }: { surveyId: string }) {
	const [copied, setCopied] = useState(false);
	const [manual, setManual] = useState("");

	const copy = async () => {
		const link = `${window.location.origin}/portal/surveys/${encodeURIComponent(surveyId)}`;
		try {
			await navigator.clipboard.writeText(link);
			setManual("");
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2000);
		} catch {
			setManual(link);
		}
	};

	return (
		<div className="grid min-w-0 gap-2 border-t border-border/60 pt-4">
			<p className="min-w-0 text-sm text-muted-foreground">Post it in your group chat. Only people who can answer will see the questions.</p>
			<Button type="button" variant="outline" size="sm" className="w-fit" onClick={copy}>
				{copied ? <Check aria-hidden /> : <Copy aria-hidden />}
				{copied ? "Copied" : "Copy form link"}
			</Button>
			{manual ? <Input readOnly value={manual} aria-label="Form link" onFocus={(event) => event.currentTarget.select()} className="min-w-0 text-xs" /> : null}
		</div>
	);
}

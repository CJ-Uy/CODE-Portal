"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/** Copies a library page's address (an item or a list). If the browser will not let the page use the clipboard, the address is shown to copy by hand. */
export function CopyLinkButton({ path }: { path: string }) {
	const toast = useToast();
	const [copied, setCopied] = useState(false);
	const [manual, setManual] = useState("");

	const copy = async () => {
		const link = `${window.location.origin}${path}`;
		try {
			await navigator.clipboard.writeText(link);
			setManual("");
			setCopied(true);
			toast({ message: "Link copied." });
			window.setTimeout(() => setCopied(false), 2000);
		} catch {
			setManual(link);
		}
	};

	return (
		<div className="grid min-w-0 gap-2">
			<Button type="button" variant="outline" onClick={copy}>
				{copied ? <Check aria-hidden /> : <Copy aria-hidden />}
				{copied ? "Copied" : "Copy link"}
			</Button>
			{manual ? <Input readOnly value={manual} aria-label="Link to copy" onFocus={(event) => event.currentTarget.select()} className="min-w-0 text-xs" /> : null}
		</div>
	);
}

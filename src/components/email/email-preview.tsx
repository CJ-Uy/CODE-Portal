import type { RenderedEmail } from "@/lib/email/render";

/**
 * Block emails come from our renderer, which escapes every value, so their body HTML is safe to inline. Author HTML
 * (`framed`) is sanitized but carries its own CSS, so it only ever renders in a sandboxed frame. Never pass inbound mail here.
 */
export function EmailPreview({ email, width = 600 }: { email: Pick<RenderedEmail, "bodyHtml" | "html" | "framed">; width?: 600 | 375 }) {
	if (email.framed) {
		return <iframe title="Email" sandbox="" srcDoc={email.html} className="h-[44rem] w-full rounded-xl border border-border bg-white" />;
	}
	return (
		<div className="rounded-xl bg-[#F5F5F6] p-3 sm:p-6">
			<div
				className="mx-auto overflow-hidden rounded-xl transition-[max-width] duration-300 ease-out motion-reduce:transition-none"
				style={{ maxWidth: width }}
				dangerouslySetInnerHTML={{ __html: email.bodyHtml }}
			/>
		</div>
	);
}

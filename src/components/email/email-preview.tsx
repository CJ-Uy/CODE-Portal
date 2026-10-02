/** Our renderer escapes every value, so its body HTML is safe to inline. Never pass inbound mail here. */
export function EmailPreview({ bodyHtml, width = 600 }: { bodyHtml: string; width?: 600 | 375 }) {
	return (
		<div className="rounded-xl bg-[#F5F5F6] p-3 sm:p-6">
			<div
				className="mx-auto overflow-hidden rounded-xl transition-[max-width] duration-300 ease-out motion-reduce:transition-none"
				style={{ maxWidth: width }}
				dangerouslySetInnerHTML={{ __html: bodyHtml }}
			/>
		</div>
	);
}

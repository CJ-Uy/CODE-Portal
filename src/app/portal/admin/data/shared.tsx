import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { formatUtc8DateTime, formatUtc8Time } from "@/lib/date-slots";

export const PAGE_SIZE = 50;

export type SearchParams = Record<string, string | string[] | undefined>;

export function firstParams(params: SearchParams) {
	return Object.fromEntries(
		Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
	);
}

export function formatDate(value: Date) {
	return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(value);
}

export function formatDateTime(value: Date) {
	return formatUtc8DateTime(value);
}

export function formatTime(value: Date) {
	return formatUtc8Time(value);
}

export function displayName(row: { memberName?: string | null; memberEmail: string }) {
	return row.memberName ?? "Member";
}

export function sectionTitle(children: ReactNode) {
	return <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground">{children}</h2>;
}

export function TermSelector({
	terms,
	selectedTermId,
	label = "School year",
	hidden,
}: {
	terms: { id: string; label: string }[];
	selectedTermId: string;
	label?: string;
	hidden?: Record<string, string | undefined>;
}) {
	return (
		<form className="flex flex-wrap items-end gap-2" method="get">
			{Object.entries(hidden ?? {}).map(([key, value]) =>
				value ? <input key={key} type="hidden" name={key} value={value} /> : null,
			)}
			<label className="grid min-w-56 gap-1 text-sm font-medium">
				{label}
				<Select name="termId" defaultValue={selectedTermId}>
					{terms.map((term) => (
						<option key={term.id} value={term.id}>
							{term.label}
						</option>
					))}
				</Select>
			</label>
			<Button type="submit" variant="secondary">
				View
			</Button>
		</form>
	);
}

export function Pager({ basePath, params, page, hasNext }: { basePath: string; params: URLSearchParams; page: number; hasNext: boolean }) {
	const href = (nextPage: number) => {
		const next = new URLSearchParams(params);
		next.set("page", String(nextPage));
		return `${basePath}?${next.toString()}`;
	};
	return (
		<div className="flex justify-end gap-2">
			<Button asChild variant="outline" size="sm" aria-disabled={page <= 1}>
				<Link href={page <= 1 ? `${basePath}?${params.toString()}` : href(page - 1)}>Previous</Link>
			</Button>
			<Button asChild variant="outline" size="sm" aria-disabled={!hasNext}>
				<Link href={hasNext ? href(page + 1) : `${basePath}?${params.toString()}`}>Next</Link>
			</Button>
		</div>
	);
}

"use client";

import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export type MemberOption = { id: string; label: string; sublabel: string };

export function MemberChecklist({ members }: { members: MemberOption[] }) {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return members;
		return members.filter(
			(m) => m.label.toLowerCase().includes(needle) || m.sublabel.toLowerCase().includes(needle),
		);
	}, [members, query]);

	function toggle(id: string, checked: boolean) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
	}

	return (
		<div className="grid gap-3">
			<Input
				aria-label="Search members"
				placeholder="Search members by name"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
			/>
			<p className="text-sm text-muted-foreground">{selected.size} selected</p>
			<ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
				{filtered.map((member) => (
					<li key={member.id}>
						<label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
							<Checkbox
								checked={selected.has(member.id)}
								onCheckedChange={(value) => toggle(member.id, value === true)}
							/>
							<span className="grid">
								<span className="font-medium">{member.label}</span>
								<span className="text-xs text-muted-foreground">{member.sublabel}</span>
							</span>
						</label>
					</li>
				))}
				{filtered.length === 0 ? (
					<li className="px-3 py-3 text-sm text-muted-foreground">No members match that search.</li>
				) : null}
			</ul>
			{Array.from(selected).map((id) => (
				<input key={id} type="hidden" name="memberIds" value={id} />
			))}
		</div>
	);
}

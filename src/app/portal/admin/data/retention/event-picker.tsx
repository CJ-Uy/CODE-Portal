"use client";

import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type EventOption = { id: string; label: string; detail?: string };

export function EventPicker({ events }: { events: EventOption[] }) {
	const [query, setQuery] = useState("");
	const [selectedId, setSelectedId] = useState("");
	const selected = events.find((event) => event.id === selectedId);
	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return events;
		return events.filter((event) => `${event.label} ${event.detail ?? ""}`.toLowerCase().includes(needle));
	}, [events, query]);

	return (
		<div className="grid gap-3">
			<input type="hidden" name="eventId" value={selectedId} />
			<div className="flex items-center justify-between gap-3 rounded-lg bg-secondary/50 px-3 py-2 text-sm">
				<span className="min-w-0 truncate text-muted-foreground">
					{selected ? <strong className="text-foreground">{selected.label}</strong> : "No event linked"}
				</span>
				{selected ? (
					<Button type="button" variant="ghost" size="sm" onClick={() => setSelectedId("")}>
						Clear
					</Button>
				) : null}
			</div>
			<div className="relative">
				<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					aria-label="Search events"
					className="pl-9"
					placeholder="Search by event, date, or place"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
			</div>
			<div className="max-h-64 overflow-y-auto rounded-lg border border-border">
				<Table>
					<TableHeader className="sticky top-0 z-10 bg-background">
						<TableRow>
							<TableHead>Event</TableHead>
							<TableHead className="w-24 text-right">Choose</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{filtered.map((event) => {
							const active = selectedId === event.id;
							return (
								<TableRow key={event.id} className={active ? "bg-secondary/60" : undefined}>
									<TableCell>
										<p className="font-medium">{event.label}</p>
										{event.detail ? <p className="text-xs text-muted-foreground">{event.detail}</p> : null}
									</TableCell>
									<TableCell className="text-right">
										<Button
											type="button"
											size="sm"
											variant={active ? "secondary" : "outline"}
											aria-pressed={active}
											onClick={() => setSelectedId(event.id)}
										>
											{active ? <Check className="size-4" /> : null}
											{active ? "Selected" : "Select"}
										</Button>
									</TableCell>
								</TableRow>
							);
						})}
						{filtered.length === 0 ? (
							<TableRow>
								<TableCell colSpan={2} className="py-8 text-center text-muted-foreground">
									No events match that search.
								</TableCell>
							</TableRow>
						) : null}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}

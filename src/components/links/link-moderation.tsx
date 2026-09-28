"use client";

import { useState } from "react";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import type { LinkListItem } from "@/db/repositories/links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { linkModerationPageUrl } from "./moderation-utils";

type LinkView = Omit<LinkListItem, "createdAt" | "updatedAt"> & { createdAt: Date | string; updatedAt: Date | string };

export function LinkModeration({ initialLinks }: { initialLinks: LinkView[] }) {
	const [links, setLinks] = useState(initialLinks);
	const [offset, setOffset] = useState(0);
	const [editingId, setEditingId] = useState("");
	const [draft, setDraft] = useState({ title: "", destinationUrl: "" });
	const [status, setStatus] = useState("");

	async function load(nextOffset: number) {
		const response = await fetch(linkModerationPageUrl(nextOffset), { credentials: "same-origin" });
		const body = await response.json() as { links?: LinkView[]; error?: string };
		if (!response.ok || !body.links) {
			setStatus(body.error ?? "Could not load links.");
			return;
		}
		setLinks(body.links);
		setOffset(nextOffset);
	}

	function startEdit(link: LinkView) {
		setEditingId(link.id);
		setDraft({ title: link.title, destinationUrl: link.destinationUrl });
	}

	async function save(id: string) {
		const response = await fetch(`/api/links/${encodeURIComponent(id)}`, {
			method: "PATCH",
			credentials: "same-origin",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(draft),
		});
		const body = await response.json() as { link?: LinkView; error?: string };
		if (!response.ok || !body.link) {
			setStatus(body.error ?? "Could not save link.");
			return;
		}
		setLinks((current) => current.map((link) => (link.id === id ? body.link! : link)));
		setEditingId("");
		setStatus("Link saved.");
	}

	async function remove(id: string) {
		const response = await fetch(`/api/links/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
		if (!response.ok) {
			setStatus("Could not delete link.");
			return;
		}
		setLinks((current) => current.filter((link) => link.id !== id));
		setStatus("Link deleted.");
	}

	return (
		<div className="grid gap-5">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="text-xs font-semibold uppercase text-primary">Admin</p>
					<h1 className="font-heading text-3xl">Link moderation</h1>
				</div>
				<Badge variant="info">{links.length} shown</Badge>
			</div>

			{status ? <p className="text-sm text-muted-foreground">{status}</p> : null}

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Slug</TableHead>
							<TableHead>Destination</TableHead>
							<TableHead>Owner</TableHead>
							<TableHead>Clicks</TableHead>
							<TableHead>Created</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{links.map((link) => (
							<TableRow key={link.id}>
								<TableCell className="font-medium">/{link.slug}</TableCell>
								<TableCell className="min-w-72">
									{editingId === link.id ? (
										<div className="grid gap-2">
											<Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
											<Input value={draft.destinationUrl} onChange={(event) => setDraft({ ...draft, destinationUrl: event.target.value })} />
										</div>
									) : (
										<span className="break-all text-muted-foreground">{link.destinationUrl}</span>
									)}
								</TableCell>
								<TableCell>{link.ownerMemberId}</TableCell>
								<TableCell>{link.clickCount}</TableCell>
								<TableCell>{new Date(link.createdAt).toLocaleDateString()}</TableCell>
								<TableCell>
									<div className="flex justify-end gap-2">
										<Button asChild variant="outline" size="icon" aria-label="Open short link">
											<a href={`/${link.slug}`} target="_blank" rel="noreferrer">
												<ExternalLink />
											</a>
										</Button>
										{editingId === link.id ? (
											<Button size="sm" onClick={() => save(link.id)}>Save</Button>
										) : (
											<Button variant="outline" size="icon" aria-label="Edit link" onClick={() => startEdit(link)}>
												<Pencil />
											</Button>
										)}
										<Button variant="ghost" size="icon" aria-label="Delete link" onClick={() => remove(link.id)}>
											<Trash2 />
										</Button>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			<div className="flex justify-end gap-2">
				<Button variant="outline" disabled={offset === 0} onClick={() => load(Math.max(0, offset - 50))}>
					Previous
				</Button>
				<Button variant="outline" onClick={() => load(offset + 50)}>
					Next
				</Button>
			</div>
		</div>
	);
}

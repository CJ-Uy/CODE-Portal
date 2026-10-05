"use client";

import { useState } from "react";
import { ExternalLink, Pencil, Save, Trash2, X } from "lucide-react";
import type { LinkListItem } from "@/db/repositories/links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminIntro } from "@/components/portal/admin-intro";
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
			<AdminIntro title="Short links" whoFor="Review member links and update their destinations" />
			<div className="flex flex-wrap justify-between gap-2"><Badge variant="info">{links.length} shown</Badge><p className="text-sm text-muted-foreground sm:hidden">Swipe the table to see all columns.</p></div>

			{status ? <p role="status" className="text-sm text-muted-foreground">{status}</p> : null}

			<div className="min-w-0 rounded-lg border bg-card">
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
						{links.length === 0 ? <TableRow><TableCell colSpan={6} className="py-8 text-muted-foreground">No short links on this page.</TableCell></TableRow> : null}
						{links.map((link) => (
							<TableRow key={link.id}>
								<TableCell className="font-medium">/{link.slug}</TableCell>
								<TableCell className="min-w-72">
									{editingId === link.id ? (
										<div className="grid gap-2">
											<Input aria-label={`Title for /${link.slug}`} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
											<Input type="url" aria-label={`Destination for /${link.slug}`} value={draft.destinationUrl} onChange={(event) => setDraft({ ...draft, destinationUrl: event.target.value })} />
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
											<><Button size="sm" onClick={() => save(link.id)}><Save />Save</Button><Button variant="ghost" size="icon" aria-label="Cancel edit" onClick={() => setEditingId("")}><X /></Button></>
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
				<Button variant="outline" disabled={links.length < 50} onClick={() => load(offset + 50)}>
					Next
				</Button>
			</div>
		</div>
	);
}

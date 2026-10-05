"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, FileUp, LoaderCircle, Pencil, Plus, Save, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { MentsAdminPerson, PmentReport } from "@/db/contract/ments";
import { mentorLine } from "@/lib/ments";
import { mutateMentsAction } from "./actions";

export function MentsEditor({ people, reports }: { people: MentsAdminPerson[]; reports: PmentReport[] }) {
	const router = useRouter();
	const nameInput = useRef<HTMLInputElement>(null);
	const [editing, setEditing] = useState<MentsAdminPerson | null>(null);
	const [query, setQuery] = useState("");
	const [raw, setRaw] = useState("");
	const [pending, startTransition] = useTransition();
	const [result, setResult] = useState<{ message?: string; error?: string }>({});
	const [removing, setRemoving] = useState<string | null>(null);
	const matches = people.filter((person) => `${person.name} ${person.cohort ?? ""}`.toLowerCase().includes(query.toLowerCase()));
	const byId = new Map(people.map((person) => [person.id, person]));
	const mentors = editing ? people.filter((person) => person.id !== editing.id && !mentorLine(people, person.id).some((ancestor) => ancestor.id === editing.id)) : people;
	useEffect(() => { if (editing) nameInput.current?.focus(); }, [editing]);

	function mutate(kind: "save" | "remove" | "import" | "removePment", value: unknown) {
		setResult({});
		startTransition(async () => {
			try {
				const next = await mutateMentsAction({ kind, value });
				setResult(next);
				if (!next.error) { setEditing(null); setRemoving(null); if (kind === "import") setRaw(""); router.refresh(); }
			} catch { setResult({ error: "Could not reach the server. Try again." }); }
		});
	}

	function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		mutate("save", { id: editing?.id, name: data.get("name"), cohort: data.get("cohort") || null, mentorId: data.get("mentorId") || null, memberEmail: data.get("memberEmail") || null });
	}

	return <div className="grid min-w-0 gap-6">
		{result.error ? <p role="alert" className="rounded-md border border-destructive p-3 text-sm">{result.error}</p> : null}
		{result.message ? <p role="status" className="flex items-center gap-2 text-sm"><Check className="size-4" />{result.message}</p> : null}
		<form key={editing?.id ?? `new-${people.length}`} onSubmit={save} className="grid gap-4 rounded-lg border bg-card p-5">
			<h2 className="font-serif text-xl">{editing ? `Edit ${editing.name}` : "Add a person"}</h2>
			<div className="grid gap-4 sm:grid-cols-2">
				<label className="grid gap-1 text-sm font-medium">Name<Input ref={nameInput} name="name" required maxLength={100} defaultValue={editing?.name ?? ""} /></label>
				<label className="grid gap-1 text-sm font-medium">Cohort (optional)<Input name="cohort" maxLength={40} defaultValue={editing?.cohort ?? ""} placeholder="e.g. Batch 2026" /></label>
				<label className="grid gap-1 text-sm font-medium">Ments<Select name="mentorId" defaultValue={editing?.mentorId ?? ""}><option value="">No ments recorded (branch root)</option>{mentors.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</Select></label>
				<label className="grid gap-1 text-sm font-medium">Portal email (optional)<Input name="memberEmail" type="email" maxLength={254} defaultValue={editing?.memberEmail ?? ""} /><span className="text-xs font-normal text-muted-foreground">Links an existing account to My line. Only admins see this email.</span></label>
			</div>
			<div className="flex flex-wrap gap-2"><Button disabled={pending} type="submit">{pending ? <LoaderCircle className="size-4 animate-spin" /> : editing ? <Save className="size-4" /> : <Plus className="size-4" />}{editing ? "Save person" : "Add person"}</Button>{editing ? <Button disabled={pending} type="button" variant="ghost" onClick={() => setEditing(null)}><X className="size-4" /> Cancel edit</Button> : null}</div>
		</form>
		<details className="min-w-0 border-b pb-4"><summary className="cursor-pointer py-2 font-medium">Import from Sheets</summary><div className="grid gap-3 pt-3"><p className="text-sm text-muted-foreground">Copy two columns: mentee name, then ments name. Paste up to 200 rows. Existing people are matched by name; import stops if a saved ments conflicts. Edit those people individually.</p><label className="grid gap-2 text-sm font-medium">Mentee and ments columns<Textarea value={raw} onChange={(event) => setRaw(event.target.value)} maxLength={64 * 1024} rows={6} placeholder={"Mentee\tMents\nAlex Reyes\tJamie Santos"} /></label><Button disabled={pending || !raw.trim()} className="justify-self-start" onClick={() => mutate("import", { raw })}><FileUp className="size-4" /> Import relationships</Button></div></details>
		<section aria-label="People in the tree" className="grid min-w-0 gap-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-serif text-xl">People ({people.length})</h2><label className="relative min-w-0 basis-full sm:max-w-sm sm:flex-1 sm:basis-auto"><span className="sr-only">Search people to edit</span><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" className="pl-9" /></label></div>
			{matches.map((person) => <div key={person.id} className="flex min-w-0 flex-wrap items-center gap-3 border-b py-3"><div className="min-w-0 flex-1 basis-40"><p className="break-words font-medium">{person.name}</p><p className="break-words text-sm text-muted-foreground">Ments: {byId.get(person.mentorId ?? "")?.name ?? "None recorded"}{person.memberId ? " · Portal account linked" : ""}</p></div><div className="flex flex-wrap gap-2"><Button disabled={pending} variant="outline" size="sm" onClick={() => { setEditing(person); }}><Pencil className="size-4" /> Edit</Button>{removing === person.id ? <><Button disabled={pending} variant="outline" size="sm" onClick={() => mutate("remove", { id: person.id })}><Trash2 className="size-4" /> Confirm remove</Button><Button variant="ghost" size="sm" onClick={() => setRemoving(null)}><X className="size-4" /> Cancel</Button></> : <Button disabled={pending || people.some((child) => child.mentorId === person.id)} variant="ghost" size="sm" onClick={() => setRemoving(person.id)}><Trash2 className="size-4" /> Remove</Button>}</div></div>)}
			{!matches.length ? <p className="py-6 text-muted-foreground">{query ? "No matching people." : "Add a person or import the mentor map to start."}</p> : null}
		</section>
		<section className="grid gap-3 border-t pt-6" aria-label="Pment reports"><h2 className="font-heading text-2xl">Pment reports ({reports.length})</h2><p className="text-sm text-muted-foreground">Members report these informal connections directly. Removing a report keeps official Ments relationships intact.</p>{reports.filter((report) => `${report.memberName} ${byId.get(report.personId)?.name ?? ""}`.toLowerCase().includes(query.toLowerCase())).map((report) => {
			const key = `pment:${report.memberId}:${report.personId}`;
			return <div key={key} className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b py-3"><p className="min-w-0 break-words text-sm"><span className="font-medium">{report.memberName}</span> reports <span className="font-medium">{byId.get(report.personId)?.name ?? "a former tree member"}</span> as a Pment.</p>{removing === key ? <div className="flex gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => mutate("removePment", { memberId: report.memberId, personId: report.personId })}><Trash2 />Confirm remove</Button><Button size="sm" variant="ghost" onClick={() => setRemoving(null)}><X />Cancel</Button></div> : <Button size="sm" variant="ghost" onClick={() => setRemoving(key)}><Trash2 />Remove report</Button>}</div>;
		})}{!reports.length ? <p className="py-4 text-sm text-muted-foreground">No Pments reported yet.</p> : null}</section>
	</div>;
}

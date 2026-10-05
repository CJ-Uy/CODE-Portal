"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Search } from "lucide-react";
import type { MentsPerson, PmentReport } from "@/db/contract/ments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reportPmentsAction } from "./actions";

export function PmentsEditor({ people, reports, memberId }: { people: MentsPerson[]; reports: PmentReport[]; memberId: string }) {
	const router = useRouter();
	const [chosen, setChosen] = useState(reports.filter((report) => report.memberId === memberId).map((report) => report.personId));
	const [query, setQuery] = useState("");
	const [message, setMessage] = useState<{ error?: string; success?: string }>({});
	const [pending, startTransition] = useTransition();
	const options = people.filter((person) => person.memberId !== memberId && (chosen.includes(person.id) || person.name.toLowerCase().includes(query.trim().toLowerCase())));
	return <section className="grid gap-3 border-t pt-6"><h2 className="font-heading text-2xl">Your Pments</h2><p className="max-w-2xl text-sm leading-6 text-muted-foreground">The people who mentor you informally. Choose up to 10 people, then save. Your reports appear immediately for members and keep official Ments relationships intact.</p><label className="relative sm:max-w-md"><span className="sr-only">Find your Pments</span><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden /><Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" className="pl-9" /></label><div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border bg-card p-2 sm:grid-cols-2">{options.map((person) => <label key={person.id} className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-secondary"><input type="checkbox" className="size-4 shrink-0 accent-primary" checked={chosen.includes(person.id)} disabled={pending || (!chosen.includes(person.id) && chosen.length >= 10)} onChange={(event) => setChosen(event.target.checked ? [...chosen, person.id] : chosen.filter((id) => id !== person.id))} /><span className="min-w-0 break-words">{person.name}</span></label>)}{!options.length ? <p className="px-2 py-3 text-sm text-muted-foreground">No matching people. A member admin can add someone who is missing.</p> : null}</div><div className="flex flex-wrap items-center gap-3"><Button disabled={pending} className="w-fit" onClick={() => startTransition(async () => { try { const result = await reportPmentsAction(chosen); setMessage(result.error ? { error: result.error } : { success: "Your Pments are saved." }); if (!result.error) router.refresh(); } catch { setMessage({ error: "Could not reach the server. Try again." }); } })}><Save />{pending ? "Saving…" : "Save Pments"}</Button><p className="text-sm text-muted-foreground">{chosen.length} of 10 selected</p></div>{message.error ? <p role="alert" className="text-sm text-destructive">{message.error}</p> : message.success ? <p role="status" className="text-sm">{message.success}</p> : null}</section>;
}

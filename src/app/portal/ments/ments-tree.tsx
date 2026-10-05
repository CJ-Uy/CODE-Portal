"use client";

import { useMemo, useState } from "react";
import { ArrowDown, Check, Copy, GitBranch, LocateFixed, Search, Users } from "lucide-react";
import type { MentsPerson } from "@/db/contract/ments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { mentorLine, mentsLabel } from "@/lib/ments";

export function MentsTree({ people, memberId, initialId }: { people: MentsPerson[]; memberId: string; initialId?: string }) {
	const me = people.find((person) => person.memberId === memberId);
	const [selectedId, setSelectedId] = useState(initialId && people.some((person) => person.id === initialId) ? initialId : me?.id ?? people[0]?.id);
	const [query, setQuery] = useState("");
	const [wholeTree, setWholeTree] = useState(false);
	const [copyStatus, setCopyStatus] = useState("");
	const byId = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
	const children = useMemo(() => {
		const map = new Map<string, MentsPerson[]>();
		for (const person of people) if (person.mentorId) map.set(person.mentorId, [...(map.get(person.mentorId) ?? []), person]);
		return map;
	}, [people]);
	const roots = people.filter((person) => !person.mentorId || !byId.has(person.mentorId));
	const selected = byId.get(selectedId ?? "") ?? people[0];
	const line = selected ? mentorLine(people, selected.id) : [];
	const mentees = children.get(selected?.id ?? "") ?? [];
	const siblings = selected?.mentorId ? (children.get(selected.mentorId) ?? []).filter((person) => person.id !== selected.id) : [];
	const matches = query.trim() ? people.filter((person) => `${person.name} ${person.cohort ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [];

	function selectPerson(id: string) {
		setSelectedId(id);
		setQuery("");
		setWholeTree(false);
		setCopyStatus("");
		const url = new URL(window.location.href);
		url.searchParams.set("person", id);
		window.history.replaceState(null, "", url);
	}

	async function copyLine() {
		try {
			const url = new URL(window.location.href);
			url.searchParams.set("person", selected.id);
			await navigator.clipboard.writeText(url.toString());
			setCopyStatus("Link copied.");
		} catch { setCopyStatus("Could not copy. Copy the address from your browser."); }
	}

	function personButton(person: MentsPerson, label?: string) {
		return <Button key={person.id} variant="outline" className="h-auto min-h-14 w-full min-w-0 flex-col gap-1 whitespace-normal px-4 py-3 text-center" onClick={() => selectPerson(person.id)}>
			{label ? <span className="text-xs font-normal text-muted-foreground">{label}</span> : null}
			<span className="break-words">{person.name}</span>
			{person.cohort ? <span className="text-xs font-normal text-muted-foreground">{person.cohort}</span> : null}
		</Button>;
	}

	if (!people.length) return <div className="py-12 text-center"><GitBranch className="mx-auto mb-3 size-8 text-muted-foreground" /><h2 className="font-serif text-2xl">The tree is ready to grow</h2><p className="mt-2 text-muted-foreground">A member admin can add the first people and their ments.</p></div>;

	return (
		<div className="grid min-w-0 gap-5">
			<div className="flex flex-wrap items-center gap-2">
				<label className="relative min-w-0 basis-full sm:max-w-md sm:flex-1 sm:basis-auto"><span className="sr-only">Search the ments tree</span><Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a name or cohort" maxLength={100} className="pl-9" /></label>
				<Button variant="outline" onClick={() => me && selectPerson(me.id)} disabled={!me}><LocateFixed className="size-4" /> My line</Button>
				<Button variant={wholeTree ? "default" : "outline"} aria-pressed={wholeTree} onClick={() => setWholeTree(!wholeTree)}><GitBranch className="size-4" /> All branches</Button>
			</div>
			{!me ? <p className="text-sm text-muted-foreground">Find yourself by name. A member admin can link your portal account to enable My line.</p> : null}
			{query.trim() ? <section aria-label="Search results" className="grid gap-2"><p role="status" className="text-sm text-muted-foreground">{matches.length} {matches.length === 1 ? "person" : "people"} found</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{matches.map((person) => personButton(person))}</div></section> : null}
			<div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"><p>{people.length} people in {roots.length} branches</p><p>Ments = mentor. Gments = your ments&apos; ments.</p></div>
			{wholeTree ? (
				<section aria-label="All mentor branches" className="grid gap-3">
					<p className="text-sm text-muted-foreground">Expand a name to follow its mentees. Choose View line to focus on that person.</p>
					{roots.map((root) => <Branch key={root.id} person={root} childrenById={children} onSelect={selectPerson} path={new Set()} />)}
				</section>
			) : (
				<section aria-label={`${selected.name}'s mentor line`} className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
					<div className="min-w-0 rounded-xl border bg-card px-4 py-6 sm:px-8">
						<div className="mx-auto grid max-w-sm justify-items-center">
							{[...line].reverse().map((person, index) => <div key={person.id} className="flex w-full flex-col items-center">{personButton(person, mentsLabel(line.length - index))}<span className="h-6 w-px bg-accent/40" aria-hidden="true" /></div>)}
							<div className="w-full rounded-lg bg-primary px-5 py-5 text-center text-primary-foreground" aria-current="true"><p className="mb-1 text-sm opacity-80">{selected.memberId === memberId ? "You" : "Exploring"}</p><h2 className="break-words font-serif text-2xl">{selected.name}</h2>{selected.cohort ? <p className="mt-1 text-sm opacity-80">{selected.cohort}</p> : null}</div>
							{mentees.length ? <ArrowDown className="my-3 size-5 text-accent" aria-hidden="true" /> : null}
						</div>
						{mentees.length ? <><h3 className="mb-3 text-center text-sm font-medium">{mentees.length === 1 ? "Mentee" : `Mentees (${mentees.length})`}</h3><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{mentees.map((person) => personButton(person))}</div></> : <p className="mt-5 text-center text-sm text-muted-foreground">No mentees recorded yet.</p>}
					</div>
					<aside className="grid content-start gap-5">
						<div aria-live="polite"><h3 className="font-serif text-xl">This line</h3><p className="mt-2 text-sm text-muted-foreground">{line.length} {line.length === 1 ? "generation" : "generations"} above {selected.memberId === memberId ? "you" : "this person"}.</p><Button variant="outline" size="sm" className="mt-3" onClick={copyLine}>{copyStatus === "Link copied." ? <Check className="size-4" /> : <Copy className="size-4" />} Copy line link</Button>{copyStatus ? <p className="mt-2 text-sm">{copyStatus}</p> : null}</div>
						{siblingSection(siblings, personButton)}
						<label className="grid gap-2 text-sm font-medium">Jump to a branch<Select value={line.at(-1)?.id ?? selected.id} onChange={(event) => selectPerson(event.target.value)}>{roots.map((root) => <option key={root.id} value={root.id}>{root.name}</option>)}</Select></label>
					</aside>
				</section>
			)}
		</div>
	);
}

function siblingSection(siblings: MentsPerson[], render: (person: MentsPerson) => React.ReactNode) {
	return siblings.length ? <div><h3 className="mb-3 flex items-center gap-2 font-serif text-xl"><Users className="size-4" /> Same ments</h3><div className="grid gap-2">{siblings.map((person) => render(person))}</div></div> : null;
}

function Branch({ person, childrenById, onSelect, path }: { person: MentsPerson; childrenById: Map<string, MentsPerson[]>; onSelect: (id: string) => void; path: Set<string> }) {
	if (path.has(person.id)) return null;
	const nextPath = new Set(path).add(person.id);
	const children = childrenById.get(person.id) ?? [];
	return <details className={path.size < 4 ? "min-w-0 border-l border-accent/30 pl-3" : "min-w-0"}><summary className="cursor-pointer break-words py-2 font-medium">{person.name} <span className="text-sm font-normal text-muted-foreground">{children.length ? `(${children.length} ${children.length === 1 ? "mentee" : "mentees"})` : "(no mentees)"}</span></summary><Button variant="ghost" size="sm" onClick={() => onSelect(person.id)}><GitBranch className="size-4" /> View line</Button><div className="grid gap-1 pt-2">{children.map((child) => <Branch key={child.id} person={child} childrenById={childrenById} onSelect={onSelect} path={nextPath} />)}</div></details>;
}

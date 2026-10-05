"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, GitBranch, LocateFixed, Maximize2, Minus, Plus, Search, X } from "lucide-react";
import type { MentsPerson, PmentReport } from "@/db/contract/ments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { layoutMentsTree, mentorLine, mentsLabel, MENTS_NODE } from "@/lib/ments";
import { cn } from "@/lib/utils";
import { PmentsEditor } from "./pments-editor";

export function MentsTree({ people, reports, memberId, initialId }: { people: MentsPerson[]; reports: PmentReport[]; memberId: string; initialId?: string }) {
	const me = people.find((person) => person.memberId === memberId);
	const [selectedId, setSelectedId] = useState(initialId && people.some((person) => person.id === initialId) ? initialId : me?.id);
	const [query, setQuery] = useState("");
	const [showPments, setShowPments] = useState(true);
	const [zoom, setZoom] = useState<number | null>(initialId ? 1 : null);
	const [viewport, setViewport] = useState({ width: 800, height: 540 });
	const [copyStatus, setCopyStatus] = useState("");
	const canvasRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const allPeople = useMemo(() => {
		const extra = new Map<string, MentsPerson>();
		if (showPments) for (const report of reports) if (!people.some((person) => person.memberId === report.memberId)) extra.set(report.memberId, { id: `pment-${report.memberId}`, name: report.memberName, cohort: null, memberId: report.memberId, mentorId: null });
		return [...people, ...extra.values()];
	}, [people, reports, showPments]);
	const tree = useMemo(() => layoutMentsTree(allPeople), [allPeople]);
	const official = useMemo(() => layoutMentsTree(people), [people]);
	const positions = useMemo(() => new Map(tree.nodes.map((node) => [node.person.id, node])), [tree]);
	const selected = allPeople.find((person) => person.id === selectedId);
	const line = selected ? mentorLine(people, selected.id) : [];
	const highlighted = new Set([selectedId, ...line.map((person) => person.id)]);
	const matches = query.trim() ? allPeople.filter((person) => `${person.name} ${person.cohort ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) : [];
	const fit = Math.min(1, (viewport.width - 24) / tree.width, (viewport.height - 24) / tree.height);
	const scale = zoom ?? fit;
	const selectedBranch = tree.branches.find((branch) => branch.nodes.some((node) => node.person.id === selectedId));

	useEffect(() => {
		const target = scrollRef.current;
		if (!target) return;
		const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }));
		observer.observe(target);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!initialId || selectedId !== initialId || zoom !== 1) return;
		const node = positions.get(initialId);
		if (node) scrollRef.current?.scrollTo({ left: node.x - viewport.width / 2 + MENTS_NODE.width / 2, top: node.y - viewport.height / 2 + MENTS_NODE.height / 2 });
	}, [initialId, positions, selectedId, viewport, zoom]);

	function selectPerson(id: string) {
		setSelectedId(id); setQuery(""); setCopyStatus(""); setZoom(1);
		const url = new URL(window.location.href);
		url.searchParams.set("person", id);
		window.history.replaceState(null, "", url);
		const node = positions.get(id);
		requestAnimationFrame(() => { if (node) scrollRef.current?.scrollTo({ left: node.x - viewport.width / 2 + MENTS_NODE.width / 2, top: node.y - viewport.height / 2 + MENTS_NODE.height / 2, behavior: "smooth" }); });
	}
	function fitAll() { setZoom(null); scrollRef.current?.scrollTo({ left: 0, top: 0 }); }
	function fitBranch() {
		if (!selectedBranch) return;
		const nodes = tree.nodes.filter((node) => selectedBranch.nodes.some((member) => member.person.id === node.person.id));
		const left = Math.min(...nodes.map((node) => node.x));
		const top = Math.min(...nodes.map((node) => node.y));
		const next = Math.min(1, (viewport.width - 32) / selectedBranch.width, (viewport.height - 32) / selectedBranch.height);
		setZoom(next);
		requestAnimationFrame(() => scrollRef.current?.scrollTo({ left: Math.max(0, left * next - 16), top: Math.max(0, top * next - 16), behavior: "smooth" }));
	}
	function clearPerson() {
		setSelectedId(undefined);
		const url = new URL(window.location.href);
		url.searchParams.delete("person");
		window.history.replaceState(null, "", url);
	}
	async function copyLine() {
		const url = new URL(window.location.href);
		if (selectedId) url.searchParams.set("person", selectedId);
		try { await navigator.clipboard.writeText(url.toString()); setCopyStatus("Link copied."); }
		catch { setCopyStatus("Could not copy. Copy the address from your browser."); }
	}
	if (!people.length) return <div className="py-12 text-center"><GitBranch className="mx-auto mb-3 size-8 text-muted-foreground" /><h2 className="font-heading text-2xl">The tree is ready to grow</h2><p className="mt-2 text-muted-foreground">A member admin can add the first people and their Ments.</p></div>;

	return <div className="grid min-w-0 gap-6">
		<div className="flex flex-wrap items-center gap-2">
			<label className="relative min-w-0 basis-full sm:max-w-md sm:flex-1 sm:basis-auto"><span className="sr-only">Search the Ments tree</span><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden /><Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a name or cohort" maxLength={100} className="pl-9" /></label>
			<Button variant="outline" onClick={() => me && selectPerson(me.id)} disabled={!me}><LocateFixed />Find me</Button>
			<label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={showPments} onChange={(event) => setShowPments(event.target.checked)} className="size-4 accent-primary" />Show Pments</label>
		</div>
		{query.trim() ? <section aria-label="Search results" className="grid gap-2"><p role="status" className="text-sm text-muted-foreground">{matches.length} {matches.length === 1 ? "person" : "people"} found</p><div className="grid max-h-60 gap-1 overflow-y-auto rounded-lg border bg-card sm:grid-cols-2">{matches.map((person) => <button key={person.id} className="min-w-0 px-3 py-2 text-left text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => selectPerson(person.id)}>{person.name}{person.cohort ? <span className="ml-2 text-muted-foreground">{person.cohort}</span> : null}</button>)}</div></section> : null}
		<div ref={canvasRef} className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card [&:fullscreen]:h-screen [&:fullscreen_.ments-scroll]:h-full">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
				<div className="flex flex-wrap gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><span className="w-5 border-t border-primary" />Official Ments</span><span className="flex items-center gap-1.5"><span className="w-5 border-t border-dashed border-accent" />Pments, self-reported</span></div>
				<div className="flex max-w-full flex-wrap items-center gap-1"><div className="flex items-center gap-1"><Button variant="ghost" size="sm" onClick={fitAll}><GitBranch />All trees</Button>{selectedBranch ? <Button variant="ghost" size="sm" onClick={fitBranch}>This tree</Button> : null}</div><div className="ml-auto flex shrink-0 items-center gap-1"><Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => setZoom(Math.max(0.02, scale / 1.5))}><Minus /></Button><span className="w-12 text-center text-xs tabular-nums" aria-label="Zoom level">{Math.round(scale * 100)}%</span><Button variant="ghost" size="icon" aria-label="Zoom in" disabled={scale >= 1.5} onClick={() => setZoom(Math.min(1.5, scale * 1.5))}><Plus /></Button><Button variant="ghost" size="icon" aria-label="View tree fullscreen" onClick={() => { const request = document.fullscreenElement ? document.exitFullscreen() : canvasRef.current?.requestFullscreen(); void request?.catch(() => setCopyStatus("Fullscreen is unavailable in this browser.")); }}><Maximize2 /></Button></div></div>
			</div>
			<div ref={scrollRef} role="region" aria-label="Complete Ments forest. Scroll to explore, or use search and zoom." tabIndex={0} className="ments-scroll h-[32rem] min-w-0 overflow-auto bg-secondary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:h-[38rem]">
				<div className="relative overflow-hidden" style={{ width: Math.max(viewport.width, tree.width * scale), height: Math.max(viewport.height, tree.height * scale) }}>
					<div className="absolute left-0 top-0 origin-top-left" style={{ width: tree.width, height: tree.height, transform: `scale(${scale})` }}>
						<svg aria-hidden className="absolute inset-0" width={tree.width} height={tree.height}>
							{tree.nodes.map((node) => { const parent = positions.get(node.person.mentorId ?? ""); if (!parent) return null; const x = parent.x + MENTS_NODE.width; const y = parent.y + MENTS_NODE.height / 2; const ty = node.y + MENTS_NODE.height / 2; return <path key={node.person.id} d={`M${x},${y} C${x + 18},${y} ${node.x - 18},${ty} ${node.x},${ty}`} fill="none" stroke={highlighted.has(node.person.id) && highlighted.has(parent.person.id) ? "#06192F" : "#90B4CC"} strokeWidth={highlighted.has(node.person.id) && highlighted.has(parent.person.id) ? 3 : 1.5} />; })}
							{showPments ? reports.map((report) => { const from = tree.nodes.find((node) => node.person.memberId === report.memberId); const to = positions.get(report.personId); if (!from || !to) return null; return <path key={`${report.memberId}-${report.personId}`} d={`M${from.x + 82},${from.y + MENTS_NODE.height} Q${(from.x + to.x) / 2},${Math.max(from.y, to.y) + 100} ${to.x + 82},${to.y + MENTS_NODE.height}`} fill="none" stroke="#0C315C" strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="5 4" />; }) : null}
						</svg>
						{tree.nodes.map(({ person, x, y }) => <button key={person.id} type="button" onClick={() => selectPerson(person.id)} aria-pressed={selectedId === person.id} aria-label={`${person.name}${person.cohort ? `, ${person.cohort}` : ""}${person.memberId === memberId ? ", you" : ""}`} className={cn("absolute flex items-center gap-2 rounded-lg border px-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", selectedId === person.id ? "border-primary bg-primary text-primary-foreground" : highlighted.has(person.id) ? "border-primary bg-secondary text-primary" : "border-border bg-card text-foreground hover:border-primary")} style={{ left: x, top: y, width: MENTS_NODE.width, height: MENTS_NODE.height }}><span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold", selectedId === person.id ? "bg-white/15" : "bg-secondary text-primary")} aria-hidden>{person.name.split(/[\s,]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("")}</span><span className="min-w-0"><span className="line-clamp-2 text-[20px] font-semibold leading-tight">{person.name}</span>{person.memberId === memberId || person.cohort ? <span className="block truncate text-[18px] leading-tight opacity-80">{person.memberId === memberId ? "You" : person.cohort}</span> : null}</span></button>)}
					</div>
				</div>
			</div>
		</div>
		<p className="text-sm text-muted-foreground">Every generation is shown. Search or tap a name to zoom to their place. Use All trees to see the whole forest.</p>
		{selected ? <section className="grid gap-3 border-b pb-5" aria-live="polite"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-heading text-2xl">{selected.name}</h2><p className="text-sm text-muted-foreground">{line.length} {line.length === 1 ? "generation" : "generations"} above · {people.filter((person) => person.mentorId === selected.id).length} mentees</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={copyLine}>{copyStatus === "Link copied." ? <Check /> : <Copy />}Copy link</Button><Button variant="ghost" size="icon" aria-label="Clear selected person" onClick={clearPerson}><X /></Button></div></div><div className="flex flex-wrap gap-2">{line.map((person, index) => <Button key={person.id} variant="outline" size="sm" onClick={() => selectPerson(person.id)}>{mentsLabel(index + 1)}: {person.name}</Button>)}</div>{copyStatus ? <p role="status" className="text-sm">{copyStatus}</p> : null}</section> : null}
		<section className="grid gap-4" aria-label="Tree statistics"><h2 className="font-heading text-2xl">How we’re connected</h2><dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">{[["People", people.length], ["Ments trees", official.branches.length], ["Deepest tree", `${official.generations} generations`], ["Pment connections", reports.length]].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd></div>)}</dl><h3 className="mt-2 font-heading text-xl">Biggest Ments trees</h3><ol className="divide-y rounded-lg border bg-card">{official.branches.slice(0, 5).map((branch) => <li key={branch.root.id}><button className="flex w-full min-w-0 items-center justify-between gap-4 px-4 py-3 text-left text-sm hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring" onClick={() => selectPerson(branch.root.id)}><span className="min-w-0 break-words font-medium">{branch.root.name}</span><span className="shrink-0 text-right tabular-nums text-muted-foreground">{branch.nodes.length} people · {branch.generations} generations</span></button></li>)}</ol></section>
		<PmentsEditor people={people} reports={reports} memberId={memberId} />
	</div>;
}

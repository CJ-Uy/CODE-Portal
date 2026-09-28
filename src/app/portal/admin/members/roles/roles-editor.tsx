"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminEntry, AssignableRole, InvitedEntry } from "@/db/repositories/roles";
import type { Member } from "@/db/types";
import type { RoleKey } from "@/server/auth/permissions";
import {
	loadMemberRolesAction,
	saveMemberRolesAction,
	savePendingRolesAction,
	searchInvitedAction,
	searchMembersAction,
} from "./actions";

/**
 * One editor drives both cases. A member has an id and a baseVersion for conflict
 * detection; an invited email has neither, because nobody holds those roles yet and there
 * is no member row to point at until they first sign in.
 */
type Editor =
	| { kind: "member"; memberId: string; displayName: string; baseVersion: string; original: RoleKey[]; desired: Set<RoleKey> }
	| { kind: "invited"; email: string; displayName: string; desired: Set<RoleKey> };

export function RolesManager({
	admins,
	assignableRoles,
	canGrantSuper,
	actorMemberId,
}: {
	admins: AdminEntry[];
	assignableRoles: AssignableRole[];
	canGrantSuper: boolean;
	actorMemberId: string;
}) {
	const router = useRouter();
	const [filter, setFilter] = useState("");
	const [results, setResults] = useState<Member[]>([]);
	const [invited, setInvited] = useState<InvitedEntry[]>([]);
	const [searching, setSearching] = useState(false);
	const [searchFailed, setSearchFailed] = useState(false);
	const [editor, setEditor] = useState<Editor | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	const labelOf = new Map(assignableRoles.map((role) => [role.key, role.label]));
	const memberName = (m: Member) => m.fullName || m.name || m.email;

	const q = filter.trim().toLowerCase();
	const shown = q
		? admins.filter(
				(a) =>
					a.displayName.toLowerCase().includes(q) ||
					a.email.toLowerCase().includes(q) ||
					a.roleKeys.some((k) => (labelOf.get(k) ?? k).toLowerCase().includes(q)),
			)
		: admins;

	// One search box for both lists. The admin table filters as you type, and the same
	// query then looks through everyone else, so finding someone who is not an admin yet
	// does not mean discovering a second search box first.
	const adminIds = new Set(admins.map((a) => a.memberId));
	const nonAdminResults = results.filter((m) => !adminIds.has(m.id));

	useEffect(() => {
		const term = filter.trim();
		// Short queries simply never fetch. Any stale results stay in state but are gated
		// out of the render below, which avoids clearing state from inside the effect.
		if (term.length < 2) return;

		// cancelled guards against an earlier, slower query overwriting a later one.
		let cancelled = false;
		// Debounced so typing a name is not one request per keystroke. Both lists are
		// searched together, because someone you are looking for might not have signed in.
		const timer = setTimeout(() => {
			setSearching(true);
			Promise.all([searchMembersAction(term), searchInvitedAction(term).catch(() => [])])
				.then(([members, invitedRows]) => {
					if (cancelled) return;
					setResults(members);
					setInvited(invitedRows);
					setSearchFailed(false);
				})
				.catch(() => {
					if (cancelled) return;
					setResults([]);
					setInvited([]);
					setSearchFailed(true);
				})
				.finally(() => {
					if (!cancelled) setSearching(false);
				});
		}, 250);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [filter]);

	function openEditor(memberId: string, displayName: string) {
		setMessage(null);
		startTransition(async () => {
			const { roleKeys, baseVersion } = await loadMemberRolesAction(memberId);
			setEditor({ kind: "member", memberId, displayName, baseVersion, original: roleKeys, desired: new Set(roleKeys) });
		});
	}

	function openInvitedEditor(email: string, roleKeys: RoleKey[]) {
		setMessage(null);
		setEditor({ kind: "invited", email, displayName: email, desired: new Set(roleKeys) });
	}

	function toggle(key: RoleKey, on: boolean) {
		setEditor((prev) => {
			if (!prev) return prev;
			const desired = new Set(prev.desired);
			if (on) desired.add(key);
			else desired.delete(key);
			return { ...prev, desired };
		});
	}

	function save() {
		if (!editor) return;
		const desiredRoleKeys = [...editor.desired];

		if (editor.kind === "invited") {
			setMessage(null);
			startTransition(async () => {
				try {
					await savePendingRolesAction({ email: editor.email, desiredRoleKeys });
					setEditor(null);
					setMessage(
						desiredRoleKeys.length > 0
							? "Saved. They will have these roles the first time they sign in."
							: "Saved. No roles are waiting for them now.",
					);
					router.refresh();
				} catch (error) {
					setMessage(error instanceof Error ? error.message : "Could not save.");
				}
			});
			return;
		}

		const removingOwn = editor.memberId === actorMemberId && editor.original.some((k) => !editor.desired.has(k));
		if (removingOwn && !window.confirm("This removes your own access. Continue?")) return;
		setMessage(null);
		startTransition(async () => {
			try {
				await saveMemberRolesAction({ memberId: editor.memberId, baseVersion: editor.baseVersion, desiredRoleKeys });
				setEditor(null);
				setMessage("Saved.");
				router.refresh();
			} catch (error) {
				setMessage(error instanceof Error ? error.message : "Could not save.");
			}
		});
	}

	return (
		<div className="grid gap-4">
			<div className="grid gap-1.5">
				<Input
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					placeholder="Search anyone by name, email, or role"
					className="max-w-sm"
					aria-label="Search admins and members"
				/>
				<p className="text-xs text-muted-foreground">
					Filters the admins below, then looks through everyone else so you can promote someone without a second search.
				</p>
			</div>

			{q.length >= 2 && (nonAdminResults.length > 0 || searching || searchFailed) ? (
				<div className="grid gap-2 rounded-xl border border-border p-4">
					<div className="flex items-center gap-2">
						<p className="text-sm font-medium">Not an admin yet</p>
						{searching ? <span className="text-xs text-muted-foreground">Searching…</span> : null}
					</div>
					{searchFailed ? (
						<p className="text-sm text-muted-foreground">Search is unavailable right now.</p>
					) : nonAdminResults.length === 0 && !searching ? (
						<p className="text-sm text-muted-foreground">No other members match.</p>
					) : (
						<ul className="grid gap-1">
							{nonAdminResults.map((m) => (
								<li
									key={m.id}
									className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
								>
									<span className="min-w-0 text-sm">
										<span className="font-medium">{memberName(m)}</span>{" "}
										<span className="break-all text-muted-foreground">{m.email}</span>
										{/* Pending and inactive members are searchable here, so label them rather
										    than leaving an admin to wonder why someone looks unfamiliar. */}
										{m.status !== "active" ? (
											<span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs capitalize text-muted-foreground">
												{m.status}
											</span>
										) : null}
									</span>
									<Button
										type="button"
										size="sm"
										variant="outline"
										className="shrink-0"
										onClick={() => openEditor(m.id, memberName(m))}
										disabled={pending}
									>
										Add as admin
									</Button>
								</li>
							))}
						</ul>
					)}
				</div>
			) : null}

			{q.length >= 2 && invited.length > 0 ? (
				<div className="grid gap-2 rounded-xl border border-border p-4">
					<div className="grid gap-0.5">
						<p className="text-sm font-medium">Invited, not signed in yet</p>
						<p className="text-xs text-muted-foreground">
							Roles granted here apply the first time they sign in, so they arrive able to do the job.
						</p>
					</div>
					<ul className="grid gap-1">
						{invited.map((entry) => (
							<li
								key={entry.email}
								className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
							>
								<span className="min-w-0 text-sm">
									<span className="break-all font-medium">{entry.email}</span>
									{entry.roleKeys.length > 0 ? (
										<span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
											{entry.roleKeys.map((k) => (
												<span key={k} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
													{labelOf.get(k) ?? k}
												</span>
											))}
										</span>
									) : null}
								</span>
								<Button
									type="button"
									size="sm"
									variant="outline"
									className="shrink-0"
									onClick={() => openInvitedEditor(entry.email, entry.roleKeys)}
									disabled={pending}
								>
									{entry.roleKeys.length > 0 ? "Edit waiting roles" : "Grant roles"}
								</Button>
							</li>
						))}
					</ul>
				</div>
			) : null}

			{editor ? (
				<div className="grid gap-3 rounded-xl border border-accent/50 bg-accent/5 p-4">
					<div className="grid gap-0.5">
						<p className="font-medium">Roles for {editor.displayName}</p>
						{editor.kind === "invited" ? (
							<p className="text-xs text-muted-foreground">
								They have not signed in yet. These apply automatically on their first sign-in.
							</p>
						) : null}
					</div>
					<div className="grid gap-2">
						{assignableRoles.map((role) => {
							const disabled = !role.assignable || (role.key === "super" && !canGrantSuper);
							return (
								<label key={role.key} className="flex items-start gap-2 text-sm">
									<input
										type="checkbox"
										className="mt-1"
										checked={editor.desired.has(role.key)}
										disabled={disabled}
										onChange={(e) => toggle(role.key, e.target.checked)}
									/>
									<span>
										<span className="font-medium">{role.label}</span>
										{role.assignable ? null : <span className="ml-1 text-xs text-muted-foreground">(coming soon)</span>}
										<span className="block text-muted-foreground">{role.description}</span>
									</span>
								</label>
							);
						})}
					</div>
					<div className="flex items-center gap-3">
						<Button type="button" onClick={save} disabled={pending}>
							Save changes
						</Button>
						<Button type="button" variant="outline" onClick={() => setEditor(null)}>
							Cancel
						</Button>
						{message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
					</div>
				</div>
			) : message ? (
				<p className="text-sm text-muted-foreground">{message}</p>
			) : null}

			<div className="overflow-x-auto rounded-xl border border-border">
				<table className="w-full text-sm">
					<thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
						<tr>
							<th className="px-4 py-2 font-semibold">Member</th>
							<th className="px-4 py-2 font-semibold">Email</th>
							<th className="px-4 py-2 font-semibold">Roles</th>
							<th className="px-4 py-2 text-right font-semibold">Action</th>
						</tr>
					</thead>
					<tbody>
						{shown.length === 0 ? (
							<tr>
								<td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
									{admins.length === 0 ? "No admins yet — add one." : "No matches."}
								</td>
							</tr>
						) : (
							shown.map((a) => (
								<tr key={a.memberId} className="border-t border-border">
									<td className="px-4 py-2 font-medium">
										{a.displayName}
										{a.memberId === actorMemberId ? <span className="ml-1 text-xs text-muted-foreground">(you)</span> : null}
									</td>
									<td className="px-4 py-2 text-muted-foreground">{a.email}</td>
									<td className="px-4 py-2">
										<div className="flex flex-wrap gap-1">
											{a.roleKeys.map((k) => (
												<span key={k} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
													{labelOf.get(k) ?? k}
												</span>
											))}
										</div>
									</td>
									<td className="px-4 py-2 text-right">
										<Button type="button" size="sm" variant="outline" onClick={() => openEditor(a.memberId, a.displayName)}>
											Edit
										</Button>
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}

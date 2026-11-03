import { redirect } from "next/navigation";
import { ChevronDown, Plus, Save, Trash2 } from "lucide-react";
import { AdminIntro } from "@/components/portal/admin-intro";
import { navPinIconFor } from "@/components/portal/nav-pin-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getRepositories } from "@/db";
import type { NavPin } from "@/db/repositories/navPins";
import { LINK_KINDS, LINK_KIND_ICONS, LINK_KIND_LABELS } from "@/lib/link-kinds";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { createNavPinAction, deleteNavPinAction, updateNavPinAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NavPinsAdminPage() {
	const actor = await requireActor();
	if (!can(actor, "nav:configure")) redirect("/portal/admin");
	const pins = await (await getRepositories()).navPins.list(actor).catch(() => []);
	return (
		<div className="grid min-w-0 gap-6">
			<AdminIntro title="Pinned nav links" whoFor="Optional shortcuts in the member sidebar and menu. Leave this empty unless a link needs to be on every page" />
			<section className="grid min-w-0 gap-4 rounded-xl border border-border/60 bg-card p-4 sm:p-5" aria-labelledby="add-pin">
				<h2 id="add-pin" className="text-xl font-semibold text-primary">Add a pin</h2>
				<form action={createNavPinAction} className="grid min-w-0 gap-4">
					<PinFields position={Math.max(-1, ...pins.map((pin) => pin.position)) + 1} />
					<Button type="submit" className="w-fit"><Plus aria-hidden />Add pin</Button>
				</form>
			</section>
			<section className="grid min-w-0 gap-3" aria-labelledby="current-pins">
				<h2 id="current-pins" className="text-2xl font-semibold text-primary">Current pins ({pins.length})</h2>
				<p className="text-sm text-muted-foreground">These are separate from Important links. Lower order numbers appear first.</p>
				{pins.length === 0 ? (
					<p className="rounded-xl border border-dashed border-border px-5 py-8 text-sm text-muted-foreground">No pinned nav links. Members can find shared resources in Important links.</p>
				) : pins.map((pin) => {
					const Icon = navPinIconFor(pin.icon);
					return (
						<details key={pin.id} className="group min-w-0 rounded-xl border border-border/60 bg-card p-4">
							<summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
								<Icon className="size-5 shrink-0 text-accent" aria-hidden />
								<span className="min-w-0 flex-1"><span className="block font-semibold [overflow-wrap:anywhere]">{pin.label}</span><span className="block text-sm text-muted-foreground [overflow-wrap:anywhere]">{pin.url}</span></span>
								<span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">Edit<ChevronDown className="size-4 group-open:rotate-180" aria-hidden /></span>
							</summary>
							<div className="mt-4 grid gap-4 border-t border-border/60 pt-4">
								<form action={updateNavPinAction} className="grid min-w-0 gap-4">
									<input type="hidden" name="id" value={pin.id} />
									<PinFields pin={pin} position={pin.position} />
									<Button type="submit" className="w-fit"><Save aria-hidden />Save changes</Button>
								</form>
								<form action={deleteNavPinAction}><input type="hidden" name="id" value={pin.id} /><Button type="submit" variant="outline"><Trash2 aria-hidden />Remove pin</Button></form>
							</div>
						</details>
					);
				})}
			</section>
		</div>
	);
}

function PinFields({ pin, position }: { pin?: NavPin; position: number }) {
	return (
		<div className="grid min-w-0 gap-4 sm:grid-cols-2">
			<label className="grid min-w-0 gap-1.5 text-sm"><span className="font-medium">Label</span><Input name="label" required maxLength={80} defaultValue={pin?.label} /></label>
			<label className="grid min-w-0 gap-1.5 text-sm"><span className="font-medium">URL</span><Input name="url" type="url" inputMode="url" required maxLength={2000} pattern="https?://.+" defaultValue={pin?.url} placeholder="https://" /></label>
			<label className="grid min-w-0 gap-1.5 text-sm"><span className="font-medium">Type</span><Select name="icon" defaultValue={pin?.icon ?? "Globe"}>{LINK_KINDS.map((kind) => <option key={kind} value={LINK_KIND_ICONS[kind]}>{LINK_KIND_LABELS[kind]}</option>)}</Select></label>
			<label className="grid min-w-0 gap-1.5 text-sm"><span className="font-medium">Order</span><Input name="position" type="number" min={0} max={999} step={1} required defaultValue={position} /></label>
		</div>
	);
}

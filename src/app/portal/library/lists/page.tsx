import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Heart, ListPlus, Plus } from "lucide-react";
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/portal/empty-state";
import { getActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";
import { createListAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function LibraryListsPage() {
	if (!isFeatureEnabled("library")) notFound();
	const actor = await getActor();
	if (!actor) redirect("/signin");

	const repositories = await getRepositories();
	const [favorites, lists] = await Promise.all([
		repositories.library.listFavorites(actor).catch(() => []),
		repositories.library.listLists(actor).catch(() => []),
	]);

	return (
		<div className="grid gap-6">
			<div>
				<Link href="/portal/library" className="text-sm text-muted-foreground hover:text-foreground">
					&larr; Library
				</Link>
				<h1 className="mt-1 font-heading text-3xl">My lists</h1>
			</div>

			<section className="grid gap-3">
				<h2 className="flex items-center gap-2 font-heading text-xl">
					<Heart className="size-5 text-accent" />
					Favorites ({favorites.length})
				</h2>
				{favorites.length === 0 ? (
					<EmptyState icon={Heart} title="No favorites yet" description="Save items from the library to find them here." />
				) : (
					<div className="grid gap-2">
						{favorites.map((item) => (
							<Link
								key={item.id}
								href={`/portal/library/${item.id}`}
								className="rounded-xl border border-border p-3 text-sm font-medium hover:border-accent"
							>
								{item.title}
								<span className="ml-2 text-xs text-muted-foreground">{item.category}</span>
							</Link>
						))}
					</div>
				)}
			</section>

			<section className="grid gap-3">
				<h2 className="flex items-center gap-2 font-heading text-xl">
					<ListPlus className="size-5 text-accent" />
					Saved lists ({lists.length})
				</h2>
				<Card>
					<CardHeader>
						<CardTitle className="text-base">New list</CardTitle>
						<CardDescription>Group library items into a named collection.</CardDescription>
					</CardHeader>
					<CardContent>
						<form action={createListAction} className="flex flex-wrap items-end gap-3">
							<label className="grid gap-1 text-sm font-medium">
								Name
								<Input name="name" placeholder="e.g. Onboarding reads" maxLength={60} required />
							</label>
							<label className="grid gap-1 text-sm font-medium">
								Color
								<Input name="color" type="color" defaultValue="#0c315c" className="h-10 w-16 p-1" />
							</label>
							<Button type="submit">
								<Plus />
								Create
							</Button>
						</form>
					</CardContent>
				</Card>
				{lists.length > 0 ? (
					<div className="grid gap-2 sm:grid-cols-2">
						{lists.map((list) => (
							<div key={list.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
								<span className="size-4 rounded-full" style={{ backgroundColor: list.color }} aria-hidden />
								<span className="text-sm font-medium">{list.name}</span>
							</div>
						))}
					</div>
				) : null}
			</section>
		</div>
	);
}

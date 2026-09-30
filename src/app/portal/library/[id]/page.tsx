import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Clock, EyeOff, Heart, Lock } from "lucide-react";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { addCommentAction, setCommentHiddenAction, toggleFavoriteAction } from "../actions";

export const dynamic = "force-dynamic";

function paragraphs(text: string): string[] {
	return text.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean);
}

export default async function LibraryItemPage({ params }: { params: Promise<{ id: string }> }) {
	if (!isFeatureEnabled("library")) notFound();
	const actor = await getActor();
	if (!actor) redirect("/signin");
	const { id } = await params;

	const repositories = await getRepositories();
	const item = await repositories.library.getItem(actor, id).catch(() => null);
	if (!item) notFound();

	const [comments, favorites] = await Promise.all([
		repositories.library.listComments(actor, id).catch(() => []),
		repositories.library.listFavorites(actor).catch(() => []),
	]);
	const isFavorited = favorites.some((favorite) => favorite.id === id);
	const canModerate = can(actor, "library:moderate");
	const topLevel = comments.filter((comment) => !comment.parentId);
	const repliesByParent = new Map<string, typeof comments>();
	for (const comment of comments) {
		if (comment.parentId) {
			repliesByParent.set(comment.parentId, [...(repliesByParent.get(comment.parentId) ?? []), comment]);
		}
	}

	return (
		<div className="mx-auto grid max-w-3xl gap-6">
			<Link href="/portal/library" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
				<ArrowLeft className="size-4" />
				Back to library
			</Link>

			<article className="grid gap-4">
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="secondary">{item.category}</Badge>
					{item.confidentiality === "confidential" ? (
						<Badge variant="warn" className="gap-1">
							<Lock className="size-3" />
							Confidential
						</Badge>
					) : null}
					<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
						<Clock className="size-3" />
						{item.readMinutes} min read
					</span>
				</div>
				<h1 className="font-heading text-3xl leading-tight">{item.title}</h1>
				{item.dek ? <p className="text-lg text-muted-foreground">{item.dek}</p> : null}

				<form action={toggleFavoriteAction}>
					<input type="hidden" name="itemId" value={item.id} />
					<Button type="submit" variant={isFavorited ? "default" : "outline"} size="sm">
						<Heart className={isFavorited ? "fill-current" : undefined} />
						{isFavorited ? "Saved" : "Save to favorites"}
					</Button>
				</form>

				{item.abstract ? (
					<Card>
						<CardContent className="space-y-3 pt-6">
							{paragraphs(item.abstract).map((paragraph, index) => (
								<p key={index} className="text-sm leading-relaxed">
									{paragraph}
								</p>
							))}
						</CardContent>
					</Card>
				) : null}

				{item.sectionsJson.map((section, index) => (
					<section key={index} className="grid gap-2">
						<h2 className="font-heading text-xl">{section.heading}</h2>
						{paragraphs(section.body).map((paragraph, pIndex) => (
							<p key={pIndex} className="text-sm leading-relaxed text-foreground/90">
								{paragraph}
							</p>
						))}
					</section>
				))}

				{item.componentsJson.length > 0 ? (
					<section className="grid gap-3">
						<h2 className="font-heading text-xl">Key components</h2>
						{item.componentsJson.map((component, index) => (
							<Card key={index}>
								<CardHeader>
									<CardTitle className="text-base">{component.name}</CardTitle>
								</CardHeader>
								<CardContent className="grid gap-1 text-sm">
									<p>{component.definition}</p>
									{component.example ? <p className="text-muted-foreground">e.g. {component.example}</p> : null}
								</CardContent>
							</Card>
						))}
					</section>
				) : null}

				{item.questionsJson.length > 0 ? (
					<section className="grid gap-2">
						<h2 className="font-heading text-xl">Questions to consider</h2>
						<ul className="list-disc space-y-1 pl-5 text-sm text-foreground/90">
							{item.questionsJson.map((question, index) => (
								<li key={index}>{question}</li>
							))}
						</ul>
					</section>
				) : null}

				{item.referencesJson.length > 0 ? (
					<section className="grid gap-2">
						<h2 className="font-heading text-xl">References</h2>
						<ul className="space-y-1 text-sm text-muted-foreground">
							{item.referencesJson.map((reference, index) => (
								<li key={index}>{reference}</li>
							))}
						</ul>
					</section>
				) : null}

				{item.topicsJson.length > 0 ? (
					<div className="flex flex-wrap gap-2 pt-2">
						{item.topicsJson.map((topic) => (
							<Badge key={topic} variant="outline">
								{topic}
							</Badge>
						))}
					</div>
				) : null}
			</article>

			<section className="grid gap-4">
				<h2 className="font-heading text-xl">Discussion ({topLevel.length})</h2>

				<form action={addCommentAction} className="grid gap-3 rounded-xl border border-border p-4">
					<input type="hidden" name="itemId" value={item.id} />
					<Textarea name="body" rows={3} placeholder="Add a comment" required />
					<div className="flex items-center justify-between gap-3">
						<label className="flex items-center gap-2 text-sm text-muted-foreground">
							<Checkbox name="anonymous" />
							Post anonymously
						</label>
						<Button type="submit" size="sm">
							Comment
						</Button>
					</div>
				</form>

				<div className="grid gap-3">
					{topLevel.map((comment) => (
						<div key={comment.id} className="grid gap-2">
							<CommentRow comment={comment} itemId={item.id} canModerate={canModerate} />
							{(repliesByParent.get(comment.id) ?? []).map((reply) => (
								<div key={reply.id} className="ml-6">
									<CommentRow comment={reply} itemId={item.id} canModerate={canModerate} />
								</div>
							))}
						</div>
					))}
				</div>
			</section>
		</div>
	);
}

function CommentRow({
	comment,
	itemId,
	canModerate,
}: {
	comment: { id: string; body: string; hidden: boolean; anonymous: boolean; createdAt: Date; authorName: string };
	itemId: string;
	canModerate: boolean;
}) {
	return (
		<div className={`rounded-xl border border-border p-3 ${comment.hidden ? "opacity-60" : ""}`}>
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-medium">
					{comment.authorName}
					{comment.anonymous && canModerate ? <span className="ml-2 text-xs text-muted-foreground">(anonymous)</span> : null}
					{comment.hidden ? <span className="ml-2 text-xs text-destructive">hidden</span> : null}
				</span>
				{canModerate ? (
					<form action={setCommentHiddenAction}>
						<input type="hidden" name="commentId" value={comment.id} />
						<input type="hidden" name="itemId" value={itemId} />
						<input type="hidden" name="hidden" value={comment.hidden ? "false" : "true"} />
						<Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-xs">
							<EyeOff className="size-3" />
							{comment.hidden ? "Unhide" : "Hide"}
						</Button>
					</form>
				) : null}
			</div>
			<p className="mt-1 text-sm text-foreground/90">{comment.body}</p>
		</div>
	);
}

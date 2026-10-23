"use client";

import Link from "next/link";
import { useTransition } from "react";
import type { FeedItem } from "@/db/repositories/notifications";
import { cn } from "@/lib/utils";
import { markNotificationReadAction } from "./actions";

/**
 * One divided row. Opening an unread notification marks it read, as the bell already does.
 * `when` is formatted on the server so the client never re-renders a different clock string.
 */
export function NotificationRow({ item, when }: { item: FeedItem; when: string }) {
	const [, startTransition] = useTransition();
	const unread = item.readAt === null;
	const body = (
		<>
			<span className={cn("mt-2 size-2 shrink-0 rounded-full", unread ? "bg-[#4986AC]" : "bg-transparent")} aria-hidden />
			<span className="grid min-w-0 flex-1 gap-0.5">
				<span className="flex min-w-0 items-baseline justify-between gap-3">
					<span className={cn("min-w-0 [overflow-wrap:anywhere]", unread ? "font-semibold" : "font-medium")}>{item.title}</span>
					<span className="shrink-0 text-xs text-muted-foreground">{when}</span>
				</span>
				<span className="line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">{item.body}</span>
				{unread ? <span className="sr-only">Unread.</span> : null}
			</span>
		</>
	);
	const rowClass = "flex min-w-0 gap-3 px-4 py-3";
	if (!item.href) return <div className={rowClass}>{body}</div>;
	return (
		<Link
			href={item.href}
			onClick={() => {
				if (unread) startTransition(() => void markNotificationReadAction(item.id));
			}}
			className={cn(rowClass, "transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}
		>
			{body}
		</Link>
	);
}

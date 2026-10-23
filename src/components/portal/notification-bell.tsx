"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Bell, CheckCheck } from "lucide-react";
import type { FeedItem } from "@/db/repositories/notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type NotificationBellProps = {
	items: FeedItem[];
	unreadCount: number;
	onMarkRead: (id: string) => Promise<void>;
	onMarkAllRead: () => Promise<void>;
};

export function NotificationBell({ items, unreadCount, onMarkRead, onMarkAllRead }: NotificationBellProps) {
	const [isPending, startTransition] = useTransition();
	const [open, setOpen] = useState(false);
	const recent = items.slice(0, 6);

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"} className="relative">
					<Bell />
					{unreadCount > 0 ? (
						<Badge
							aria-hidden
							className="absolute -right-1 -top-1 h-5 min-w-5 justify-center border-0 bg-[#90B4CC] px-1 text-[11px] text-primary"
						>
							{unreadCount > 9 ? "9+" : unreadCount}
						</Badge>
					) : null}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-80">
				<div className="flex items-center justify-between px-2 py-1.5">
					<span className="text-sm font-semibold">Notifications</span>
					<Button
						variant="ghost"
						size="sm"
						disabled={isPending || unreadCount === 0}
						onClick={() => startTransition(() => void onMarkAllRead())}
					>
						<CheckCheck />
						Mark all read
					</Button>
				</div>
				<DropdownMenuSeparator />
				{recent.length === 0 ? (
					<p className="px-2 py-6 text-center text-sm text-muted-foreground">You are all caught up.</p>
				) : (
					recent.map((item) => (
						<DropdownMenuItem
							key={item.id}
							className="flex flex-col items-start gap-0.5"
							onSelect={() => {
								if (item.readAt === null) {
									startTransition(() => void onMarkRead(item.id));
								}
							}}
							asChild
						>
							<Link href={item.href ?? "/portal/notifications"}>
								<span className="flex w-full items-center justify-between gap-2">
									<span className="text-sm font-medium">{item.title}</span>
									{item.readAt === null ? <span className="size-2 shrink-0 rounded-full bg-[#4986AC]" aria-hidden /> : null}
								</span>
								<span className="text-xs text-muted-foreground">{item.body}</span>
							</Link>
						</DropdownMenuItem>
					))
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href="/portal/notifications" className="justify-center text-sm font-medium">
						See all notifications
					</Link>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

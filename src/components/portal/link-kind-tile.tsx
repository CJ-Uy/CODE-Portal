import { createElement } from "react";
import { LINK_KIND_ICONS, type LinkKind } from "@/lib/link-kinds";
import { cn } from "@/lib/utils";
import { navPinIconFor } from "./nav-pin-icons";

export function LinkKindTile({ kind, className }: { kind: LinkKind; className?: string }) {
	return (
		<span className={cn("grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-accent", className)} aria-hidden>
			{createElement(navPinIconFor(LINK_KIND_ICONS[kind]), { className: "size-5" })}
		</span>
	);
}

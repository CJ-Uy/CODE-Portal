"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClientDataDialog } from "./edit/publish-dialog";

/** For the owner or a moderator of a published item: "this now includes client names or client data" (Task 12's dialog and action). */
export function FlagClientDataButton({ itemId }: { itemId: string }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button type="button" variant="ghost" aria-haspopup="dialog" onClick={() => setOpen(true)}>
				<ShieldAlert aria-hidden />
				Flag client data
			</Button>
			<ClientDataDialog open={open} onOpenChange={setOpen} itemId={itemId} />
		</>
	);
}

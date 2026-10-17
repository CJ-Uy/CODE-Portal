"use client";

import { useState } from "react";
import { DraftForm, type DraftFormProps } from "./draft-form";
import { SendPanel, type SendPanelProps } from "./send-panel";

/** Holds the one fact the two halves share: whether the editor has changes the send would leave behind. */
export function DraftWorkspace({ draft, send }: { draft: DraftFormProps; send: SendPanelProps }) {
	const [dirty, setDirty] = useState(false);
	return (
		<>
			<DraftForm {...draft} onDirtyChange={setDirty} />
			<SendPanel {...send} unsaved={dirty} />
		</>
	);
}

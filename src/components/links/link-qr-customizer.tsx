"use client";

import { useEffect, useRef, useState } from "react";
import type { QrStyle } from "@/db/repositories/links";
import { StyledLinkQr } from "./styled-link-qr";
import { normalizeQrStyle } from "./qr-style";

type LinkQrCustomizerProps = {
	url: string;
	style?: QrStyle;
	editable?: boolean;
	linkId?: string;
	onSave?(style: QrStyle): void;
};

export function LinkQrCustomizer(props: LinkQrCustomizerProps) {
	return <LinkQrDraft key={JSON.stringify([props.linkId, props.url, props.style])} {...props} />;
}

function LinkQrDraft({ url, style, editable = true, linkId, onSave }: LinkQrCustomizerProps) {
	const [draft, setDraft] = useState<QrStyle>(() => normalizeQrStyle(style));
	const uploadRequest = useRef(0);

	useEffect(() => () => {
		uploadRequest.current += 1;
	}, []);

	// Reuse the link_preview upload path. Those objects live in the public `links/`
	// namespace, so the returned key is loadable as a same-origin image for the QR logo.
	async function uploadLogo(file: File): Promise<string | null> {
		if (!linkId) return null;
		const request = ++uploadRequest.current;
		const body = new FormData();
		body.set("purpose", "link_preview");
		body.set("linkId", linkId);
		body.set("file", file);
		const response = await fetch("/api/uploads", { method: "POST", credentials: "same-origin", body });
		const result = await response.json().catch(() => null) as { key?: string; error?: string } | null;
		if (request !== uploadRequest.current || !response.ok || !result?.key) return null;
		return `/api/uploads/${encodeURIComponent(result.key)}`;
	}

	return <StyledLinkQr url={url} style={draft} editable={editable} onChange={setDraft} onUploadLogo={linkId ? uploadLogo : undefined} onSave={onSave ? () => onSave(draft) : undefined} />;
}

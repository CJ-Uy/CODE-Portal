"use client";

/* eslint-disable @next/next/no-img-element -- QR previews use browser-generated blob URLs. */
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { CheckCircle2, Download, Expand, ImagePlus, LoaderCircle, RotateCcw, Save, TriangleAlert, X } from "lucide-react";
import type { QrStyle } from "@/db/repositories/links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { renderQrArtifacts } from "./qr-render";
import {
	CODE_LOGO,
	CODE_LOGO_WHITE,
	ORG_QR_STYLE,
	QR_CORNERS,
	QR_EXPORT_SIZES,
	QR_LOGO_SIZES,
	QR_PATTERNS,
	normalizeQrStyle,
	qrBackgroundMode,
	qrColorContrast,
	qrTrackingUrl,
	type QrBackgroundMode,
	withQrBackground,
} from "./qr-style";

export { ORG_QR_STYLE } from "./qr-style";

type StyledQrProps = {
	url: string;
	style?: QrStyle;
	downloadName?: string;
	editable?: boolean;
	onChange?(style: QrStyle): void;
	onUploadLogo?(file: File): Promise<string | null>;
	onSave?(): void;
};

type RenderedQr = {
	key: string;
	svg: Blob;
	png: Blob | null;
	svgUrl: string;
	verified: boolean;
};

type ValidationState = "checking" | "passed" | "failed" | "contrast" | "error";
type ValidationResult = { key: string; state: ValidationState; message: string };

const CHECKERBOARD = "[background-color:#fff] [background-image:linear-gradient(45deg,#D7DFE9_25%,transparent_25%),linear-gradient(-45deg,#D7DFE9_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#D7DFE9_75%),linear-gradient(-45deg,transparent_75%,#D7DFE9_75%)] [background-position:0_0,0_8px,8px_-8px,-8px_0] [background-size:16px_16px]";

export function StyledLinkQr({ url, style, downloadName = "short-link-qr", editable = false, onChange, onUploadLogo, onSave }: StyledQrProps) {
	const normalizedStyle = useMemo(() => normalizeQrStyle(style), [style]);
	const localSourceKey = useMemo(() => JSON.stringify([url, normalizedStyle]), [normalizedStyle, url]);
	const [localStyle, setLocalStyle] = useState({ key: localSourceKey, value: normalizedStyle });
	const [exportSize, setExportSize] = useState<(typeof QR_EXPORT_SIZES)[number]>(1024);
	const [rendered, setRendered] = useState<RenderedQr | null>(null);
	const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
	const [fullscreen, setFullscreen] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [uploadError, setUploadError] = useState("");
	const [attempt, setAttempt] = useState(0);
	const generation = useRef(0);
	const uploadRequest = useRef(0);
	const renderedRef = useRef<RenderedQr | null>(null);
	const fullscreenTriggerRef = useRef<HTMLButtonElement>(null);
	const qrStyle = onChange ? normalizedStyle : localStyle.key === localSourceKey ? localStyle.value : normalizedStyle;
	const qrContent = useMemo(() => qrTrackingUrl(url), [url]);
	const contrastBackground = qrStyle.transparentBackground ? "#FFFFFF" : qrStyle.background;
	const hasSafeContrast = qrColorContrast(qrStyle.foreground, contrastBackground) >= 4.5;
	const logoSizeIndex = Math.max(0, QR_LOGO_SIZES.findIndex((option) => option.value === qrStyle.logoSize));
	const renderKey = useMemo(() => JSON.stringify([qrContent, qrStyle, exportSize]), [exportSize, qrContent, qrStyle]);
	const generationKey = `${renderKey}:${attempt}`;
	const currentRender = rendered?.key === renderKey ? rendered : null;
	const validation = validationResult?.key === generationKey ? validationResult.state : hasSafeContrast ? "checking" : "contrast";
	const message = validationResult?.key === generationKey ? validationResult.message : "";
	const downloadsReady = validation === "passed" && currentRender?.verified && currentRender.png;

	useEffect(() => {
		const request = ++generation.current;
		const controller = new AbortController();
		const timer = window.setTimeout(() => {
			void renderQrArtifacts(qrContent, qrStyle, exportSize, hasSafeContrast, controller.signal)
				.then((artifacts) => {
					if (request !== generation.current || controller.signal.aborted) return;
					const next: RenderedQr = {
						key: renderKey,
						svg: artifacts.svg,
						png: artifacts.png,
						svgUrl: URL.createObjectURL(artifacts.svg),
						verified: artifacts.verified,
					};
					const previous = renderedRef.current;
					renderedRef.current = next;
					setRendered(next);
					if (previous) URL.revokeObjectURL(previous.svgUrl);
					setValidationResult({ key: generationKey, state: hasSafeContrast ? (artifacts.verified ? "passed" : "failed") : "contrast", message: "" });
				})
				.catch((error: unknown) => {
					if (request !== generation.current || controller.signal.aborted) return;
					setValidationResult({ key: generationKey, state: "error", message: error instanceof Error ? error.message : "Could not generate this QR code." });
				});
		}, 160);

		return () => {
			window.clearTimeout(timer);
			controller.abort();
		};
	}, [exportSize, generationKey, hasSafeContrast, qrContent, qrStyle, renderKey]);

	useEffect(() => () => {
		generation.current += 1;
		uploadRequest.current += 1;
		if (renderedRef.current) URL.revokeObjectURL(renderedRef.current.svgUrl);
	}, []);

	function patch(patchStyle: Partial<QrStyle>) {
		const next = normalizeQrStyle({ ...qrStyle, ...patchStyle });
		if (onChange) onChange(next);
		else setLocalStyle({ key: localSourceKey, value: next });
	}

	function chooseBackground(mode: QrBackgroundMode) {
		const next = withQrBackground(qrStyle, mode);
		if (onChange) onChange(next);
		else setLocalStyle({ key: localSourceKey, value: next });
	}

	async function handleLogoFile(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file || !onUploadLogo) return;
		if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
			setUploadError("Use a PNG, JPEG, or WebP logo up to 5 MB.");
			return;
		}
		const request = ++uploadRequest.current;
		setUploading(true);
		setUploadError("");
		try {
			const uploadedUrl = await onUploadLogo(file);
			if (request !== uploadRequest.current) return;
			if (uploadedUrl) patch({ logoUrl: uploadedUrl, showLogo: true });
			else setUploadError("Logo upload failed. Try again.");
		} catch {
			if (request === uploadRequest.current) setUploadError("Logo upload failed. Try again.");
		} finally {
			if (request === uploadRequest.current) setUploading(false);
		}
	}

	function useCodeLogo() {
		const dark = qrBackgroundMode(qrStyle) === "dark" && !qrStyle.showLogoBacking;
		patch({ logoUrl: dark ? CODE_LOGO_WHITE : CODE_LOGO, showLogo: true });
	}

	function download(blob: Blob | null, extension: "png" | "svg") {
		if (!blob || !downloadsReady) return;
		const objectUrl = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = objectUrl;
		anchor.download = `${safeDownloadName(downloadName)}-${exportSize}.${extension}`;
		anchor.click();
		window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
	}

	const validationMessage = validation === "checking"
		? "Checking PNG and SVG scans at full size and 256 px."
		: validation === "passed"
			? qrStyle.transparentBackground
				? "Scan check passed on white at full size and 256 px. Test the transparent file on its final background."
				: "Scan check passed for PNG and SVG at full size and 256 px."
			: validation === "failed"
				? "This design failed the scan check. Reduce the logo or simplify the pattern."
				: validation === "contrast"
					? "Increase foreground and background contrast to at least 4.5:1."
					: message || "The scan check could not finish. Retry before downloading.";

	return (
		<div className={cn("grid min-w-0 gap-6", editable && "lg:grid-cols-[minmax(240px,0.9fr)_minmax(0,1.1fr)] lg:items-start")}>
			<section className="min-w-0">
				<div className={cn("mx-auto aspect-square w-full max-w-60 overflow-hidden rounded-lg border border-border p-2 sm:max-w-80", qrStyle.transparentBackground ? CHECKERBOARD : "bg-white")} aria-busy={validation === "checking"}>
					{rendered ? (
						<img src={rendered.svgUrl} alt={`QR code for ${url}`} className={cn("size-full", !currentRender && "opacity-50")} />
					) : (
						<div className="grid size-full place-items-center bg-secondary/50 text-sm text-muted-foreground">
							<LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
							<span className="sr-only">Generating QR code</span>
						</div>
					)}
				</div>

				<fieldset className="mx-auto mt-4 max-w-80">
					<legend className="mb-2 text-xs font-medium">Export background</legend>
					<div className="grid grid-cols-3 gap-2">
						{(["light", "dark", "transparent"] as const).map((mode) => (
							<Button key={mode} type="button" variant={qrBackgroundMode(qrStyle) === mode ? "default" : "outline"} className="min-h-11 px-2 capitalize" aria-pressed={qrBackgroundMode(qrStyle) === mode} onClick={() => chooseBackground(mode)}>
								{mode}
							</Button>
						))}
					</div>
				</fieldset>

				<div role={validation === "failed" || validation === "contrast" || validation === "error" ? "alert" : "status"} className={cn("mx-auto mt-3 flex min-h-10 max-w-80 items-start gap-2 text-xs leading-relaxed", validation === "passed" ? "text-emerald-700" : validation === "checking" ? "text-muted-foreground" : "text-destructive")}>
					{validation === "passed" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : validation === "checking" ? <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
					<span>{validationMessage}</span>
				</div>

				<div className="mx-auto mt-3 grid max-w-80 gap-3">
					<label className="grid gap-1 text-xs font-medium">
						Export size
						<Select value={exportSize} onChange={(event) => setExportSize(Number(event.target.value) as (typeof QR_EXPORT_SIZES)[number])}>
							{QR_EXPORT_SIZES.map((size) => <option key={size} value={size}>{size} × {size} px</option>)}
						</Select>
					</label>
					<div className="grid grid-cols-2 gap-2">
						<Button type="button" className="min-h-11" disabled={!downloadsReady} onClick={() => download(currentRender?.png ?? null, "png")}>
							<Download /> PNG
						</Button>
						<Button type="button" variant="outline" className="min-h-11" disabled={!downloadsReady} onClick={() => download(currentRender?.svg ?? null, "svg")}>
							<Download /> SVG
						</Button>
					</div>
					<Button ref={fullscreenTriggerRef} type="button" variant="ghost" className="min-h-11" disabled={!currentRender} onClick={() => setFullscreen(true)}>
						<Expand /> Full screen
					</Button>
				</div>
				<p className="mx-auto mt-3 max-w-80 text-xs text-muted-foreground">Includes <code>?source=qr</code>. The saved destination does not change.</p>
			</section>

			{editable ? (
				<details className="min-w-0 border-t border-border pt-3 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
					<summary className="flex min-h-11 cursor-pointer items-center font-semibold text-primary">Customize QR code</summary>
					<div className="mt-3 border-t border-border pt-4">
					<div className="flex items-center justify-between gap-3">
						<p className="text-sm text-muted-foreground">Pattern, corners, colors, and logo</p>
						<Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => onChange ? onChange(ORG_QR_STYLE) : setLocalStyle({ key: localSourceKey, value: ORG_QR_STYLE })}>
							<RotateCcw /> Reset
						</Button>
					</div>

					<fieldset className="mt-5">
						<legend className="mb-2 text-sm font-medium">Module pattern</legend>
						<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
							{QR_PATTERNS.map((option) => (
								<Button key={option.value} type="button" variant={qrStyle.pattern === option.value ? "default" : "outline"} className="min-h-11 px-2 text-xs" aria-pressed={qrStyle.pattern === option.value} onClick={() => patch({ pattern: option.value })}>
									{option.label}
								</Button>
							))}
						</div>
					</fieldset>

					<fieldset className="mt-5">
						<legend className="mb-2 text-sm font-medium">Corner style</legend>
						<div className="grid grid-cols-3 gap-2">
							{QR_CORNERS.map((option) => (
								<Button key={option.value} type="button" variant={qrStyle.cornerStyle === option.value ? "default" : "outline"} className="min-h-11 px-2 text-xs" aria-pressed={qrStyle.cornerStyle === option.value} onClick={() => patch({ cornerStyle: option.value })}>
									{option.label}
								</Button>
							))}
						</div>
					</fieldset>

					<div className="mt-5 grid gap-3 sm:grid-cols-2">
						<ColorField label="Foreground" value={qrStyle.foreground} onChange={(foreground) => patch({ foreground })} />
						<ColorField label="Background" value={qrStyle.background} onChange={(background) => patch({ background, transparentBackground: false })} />
					</div>

					<fieldset className="mt-5 border-t border-border pt-4">
						<legend className="pr-2 text-sm font-medium">Center logo</legend>
						<label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
							Show logo
							<input type="checkbox" role="switch" className="size-5 accent-primary" checked={qrStyle.showLogo} onChange={(event) => patch({ showLogo: event.target.checked })} />
						</label>

						{qrStyle.showLogo ? (
							<div className="mt-3 grid gap-4 border-l-2 border-secondary pl-4">
								<div className="flex flex-wrap gap-2">
									<Button type="button" variant={qrStyle.logoUrl === CODE_LOGO || qrStyle.logoUrl === CODE_LOGO_WHITE ? "default" : "outline"} className="min-h-11" aria-pressed={qrStyle.logoUrl === CODE_LOGO || qrStyle.logoUrl === CODE_LOGO_WHITE} onClick={useCodeLogo}>Use CODE logo</Button>
									{onUploadLogo ? (
										<Button asChild variant="outline" className="min-h-11">
											<label className={cn("cursor-pointer focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2", uploading && "pointer-events-none opacity-50")} aria-disabled={uploading}>
												<ImagePlus /> {uploading ? "Uploading..." : "Upload logo"}
												<input className="sr-only" type="file" disabled={uploading} accept="image/png,image/jpeg,image/webp" onChange={handleLogoFile} />
											</label>
										</Button>
									) : null}
								</div>
								<label className="grid gap-1 text-xs font-medium">
									Logo URL
									<Input value={qrStyle.logoUrl ?? ""} placeholder="Paste an image URL" onChange={(event) => patch({ logoUrl: event.target.value || null })} />
								</label>
								{uploadError ? <p role="alert" className="text-xs text-destructive">{uploadError}</p> : null}
								<label className="grid gap-2 text-xs font-medium">
									<span className="flex items-center justify-between gap-3">Logo size <output>{QR_LOGO_SIZES[logoSizeIndex]?.label}</output></span>
									<input
										type="range"
										aria-label="Logo size"
										min="0"
										max={QR_LOGO_SIZES.length - 1}
										step="1"
										value={logoSizeIndex}
										className="min-h-11 w-full accent-primary"
										onChange={(event) => patch({ logoSize: QR_LOGO_SIZES[Number(event.target.value)]?.value ?? ORG_QR_STYLE.logoSize })}
									/>
								</label>
								<label className="grid gap-1 text-xs font-medium">
									Logo margin
									<Input type="number" min="0" max="24" value={qrStyle.logoMargin} onChange={(event) => patch({ logoMargin: Number(event.target.value) })} />
								</label>
								<label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
									Add logo backing
									<input type="checkbox" role="switch" className="size-5 accent-primary" checked={qrStyle.showLogoBacking} onChange={(event) => patch({ showLogoBacking: event.target.checked })} />
								</label>
								{qrStyle.showLogoBacking ? (
									<div className="grid gap-3 sm:grid-cols-2">
										<label className="grid gap-1 text-xs font-medium">
											Backing shape
											<Select value={qrStyle.logoBackingShape} onChange={(event) => patch({ logoBackingShape: event.target.value as QrStyle["logoBackingShape"] })}>
												<option value="circle">Circle</option>
												<option value="square">Square</option>
											</Select>
										</label>
										<ColorField label="Backing color" value={qrStyle.logoBackingColor} onChange={(logoBackingColor) => patch({ logoBackingColor })} />
									</div>
								) : null}
							</div>
						) : null}
					</fieldset>

					{onSave ? (
						<Button type="button" className="mt-5 min-h-11 w-full" onClick={onSave}>
							<Save /> Save QR style
						</Button>
					) : null}
					</div>
				</details>
			) : null}

			<DialogPrimitive.Root open={fullscreen} onOpenChange={setFullscreen}>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[#06192F]/90" />
					<DialogPrimitive.Content
						className="fixed left-1/2 top-1/2 z-[61] grid max-h-[94dvh] w-[min(94vw,840px)] -translate-x-1/2 -translate-y-1/2 justify-items-center gap-4 overflow-auto rounded-lg border border-white/20 bg-[#06192F] p-5 text-center text-white shadow-xl"
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							fullscreenTriggerRef.current?.focus();
						}}
					>
						<DialogPrimitive.Title className="font-heading text-xl">QR code for {url}</DialogPrimitive.Title>
						<DialogPrimitive.Description className="sr-only">Full-screen short-link QR preview. Press Escape to close.</DialogPrimitive.Description>
						{currentRender ? <div className={cn("aspect-square w-[min(76dvh,80vw)] overflow-hidden rounded-lg p-3", qrStyle.transparentBackground ? CHECKERBOARD : "bg-white")}><img src={currentRender.svgUrl} alt={`QR code for ${url}`} className="size-full" /></div> : null}
						<p className="max-w-full break-all text-sm font-semibold">{url}</p>
						<DialogPrimitive.Close asChild>
							<Button type="button" variant="outline" className="absolute right-3 top-3 min-h-11 border-white/40 bg-[#06192F] text-white hover:bg-white hover:text-[#06192F]">
								<X /> <span className="sr-only">Close full-screen QR preview</span>
							</Button>
						</DialogPrimitive.Close>
					</DialogPrimitive.Content>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>

			{validation === "error" ? (
				<Button type="button" variant="ghost" className="min-h-11 justify-self-start text-xs" onClick={() => setAttempt((value) => value + 1)}>Retry QR check</Button>
			) : null}
		</div>
	);
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
	return (
		<label className="grid gap-1 text-xs font-medium">
			{label}
			<span className="flex h-11 items-center gap-2 rounded-md border border-input bg-background pr-3">
				<input type="color" aria-label={label} className="size-10 cursor-pointer rounded-md border-0 bg-transparent p-1" value={value} onChange={(event) => onChange(event.target.value)} />
				<code className="text-xs">{value.toUpperCase()}</code>
			</span>
		</label>
	);
}

function safeDownloadName(value: string): string {
	return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "short-link-qr";
}

"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

/**
 * Branded QR renderer: hi-DPI canvas with the falcon badge punched into the middle.
 *
 * Payload-agnostic on purpose — the member check-in code and the event share link are
 * different strings but the same picture, so they share one implementation.
 */
export function QrCanvas({
	payload,
	label,
	size = 220,
	className,
}: {
	payload: string;
	label: string;
	size?: number;
	className?: string;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		let cancelled = false;
		setError(null);
		// Render the backing store at device resolution and pin display size, so the
		// QR + center logo stay crisp on hi-DPI screens instead of being upscaled.
		const dpr = Math.min(window.devicePixelRatio || 1, 3); // ponytail: cap at 3x, extra pixels are wasted
		// errorCorrectionLevel H (30% recovery) so the center logo badge stays scannable.
		QRCode.toCanvas(canvas, payload, { width: size * dpr, margin: 1, errorCorrectionLevel: "H" })
			.then(() => {
				canvas.style.width = `${size}px`;
				canvas.style.height = `${size}px`;
				const ctx = canvas.getContext("2d");
				if (!ctx || cancelled) return;
				const logo = new Image();
				logo.onload = () => {
					// Guards a stale load from painting its badge over a QR that has since swapped
					// payloads — toggling modes re-runs this effect against the same canvas.
					if (cancelled) return;
					ctx.imageSmoothingEnabled = true;
					ctx.imageSmoothingQuality = "high";
					// White circle backing keeps QR modules from showing through the transparent logo.
					const badge = canvas.width * 0.24;
					const center = canvas.width / 2;
					ctx.beginPath();
					ctx.arc(center, center, badge / 2, 0, Math.PI * 2);
					ctx.fillStyle = "#ffffff";
					ctx.fill();
					const scale = (badge * 0.72) / Math.max(logo.width, logo.height);
					const width = logo.width * scale;
					const height = logo.height * scale;
					ctx.drawImage(logo, center - width / 2, center - height / 2, width, height);
				};
				// SVG source: drawImage rasterizes it at the destination resolution, so the
				// badge stays razor-sharp at any devicePixelRatio (the PNG was only 430px).
				logo.src = "/code-falcon-transparent.svg";
			})
			.catch(() => setError("Could not render the code."));
		return () => {
			cancelled = true;
		};
	}, [payload, size]);

	return (
		<div className={cn("flex w-fit flex-col items-center gap-3", className)}>
			<div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-border">
				<canvas ref={canvasRef} aria-label={label} className="block" />
			</div>
			{error ? <p className="text-sm text-destructive">{error}</p> : null}
		</div>
	);
}

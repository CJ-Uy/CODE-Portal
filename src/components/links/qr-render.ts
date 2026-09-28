import jsQR from "jsqr";
import type { QrStyle } from "@/db/repositories/links";
import { isSelfContainedQrSvg, qrCornerTypes, qrDotType } from "./qr-style";

export type QrArtifacts = {
	svg: Blob;
	png: Blob | null;
	verified: boolean;
};

export async function renderQrArtifacts(payload: string, style: QrStyle, size: number, verify: boolean, signal?: AbortSignal): Promise<QrArtifacts> {
	const { default: QRCodeStyling } = await import("qr-code-styling");
	const corners = qrCornerTypes(style.cornerStyle);
	const image = style.showLogo && style.logoUrl ? await logoBadge(style, signal) : undefined;
	throwIfAborted(signal);

	const qr = new QRCodeStyling({
		type: "svg",
		width: size,
		height: size,
		data: payload,
		margin: Math.ceil((size * 4) / 29),
		qrOptions: { errorCorrectionLevel: "H", mode: "Byte" },
		dotsOptions: { type: qrDotType(style.pattern), color: style.foreground },
		cornersSquareOptions: { type: corners.frame, color: style.foreground },
		cornersDotOptions: { type: corners.eye, color: style.foreground },
		backgroundOptions: { color: style.transparentBackground ? "transparent" : style.background },
		image,
		imageOptions: {
			imageSize: style.logoSize,
			margin: Math.round((style.logoMargin * size) / 512),
			hideBackgroundDots: true,
			saveAsBlob: true,
			crossOrigin: "anonymous",
		},
	});

	const rawSvg = await qr.getRawData("svg");
	if (!(rawSvg instanceof Blob)) throw new Error("QR SVG generation failed.");
	const svgText = await rawSvg.text();
	if (!isSelfContainedQrSvg(svgText)) throw new Error("QR SVG contains an external image reference.");
	const svg = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
	throwIfAborted(signal);
	if (!verify) return { svg, png: null, verified: false };

	const scanBackground = style.transparentBackground ? "#FFFFFF" : undefined;
	const [fullSvgCanvas, smallSvgCanvas] = await Promise.all([
		rasterize(svg, size, scanBackground),
		rasterize(svg, 256, scanBackground),
	]);
	throwIfAborted(signal);

	const exportCanvas = style.transparentBackground ? await rasterize(svg, size) : fullSvgCanvas;
	const png = await canvasBlob(exportCanvas);
	const [fullPngCanvas, smallPngCanvas] = await Promise.all([
		rasterize(png, size, scanBackground),
		rasterize(png, 256, scanBackground),
	]);
	throwIfAborted(signal);

	const verified = [fullSvgCanvas, smallSvgCanvas, fullPngCanvas, smallPngCanvas]
		.every((canvas) => decodeQr(canvas) === payload);
	return { svg, png, verified };
}

async function logoBadge(style: QrStyle, signal?: AbortSignal): Promise<string> {
	const response = await fetch(style.logoUrl!, { credentials: "same-origin", signal });
	if (!response.ok) throw new Error("Could not load the QR logo.");
	const blob = await response.blob();
	if (!blob.type.startsWith("image/")) throw new Error("QR logo must be an image.");
	const source = await blobDataUrl(blob);
	const background = style.showLogoBacking
		? style.logoBackingShape === "circle"
			? `<circle cx="50" cy="50" r="50" fill="${style.logoBackingColor}"/>`
			: `<rect width="100" height="100" fill="${style.logoBackingColor}"/>`
		: "";
	const inset = style.showLogoBacking ? 8 : 3;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${background}<image href="${source}" x="${inset}" y="${inset}" width="${100 - inset * 2}" height="${100 - inset * 2}" preserveAspectRatio="xMidYMid meet"/></svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function blobDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the QR logo."));
		reader.onerror = () => reject(reader.error ?? new Error("Could not read the QR logo."));
		reader.readAsDataURL(blob);
	});
}

function rasterize(source: Blob, size: number, background?: string): Promise<HTMLCanvasElement> {
	return new Promise((resolve, reject) => {
		const objectUrl = URL.createObjectURL(source);
		const image = new Image();
		image.onload = () => {
			try {
				const canvas = document.createElement("canvas");
				canvas.width = size;
				canvas.height = size;
				const context = canvas.getContext("2d", { willReadFrequently: true });
				if (!context) throw new Error("Canvas is unavailable.");
				if (background) {
					context.fillStyle = background;
					context.fillRect(0, 0, size, size);
				}
				context.drawImage(image, 0, 0, size, size);
				resolve(canvas);
			} catch (error) {
				reject(error);
			} finally {
				URL.revokeObjectURL(objectUrl);
			}
		};
		image.onerror = () => {
			URL.revokeObjectURL(objectUrl);
			reject(new Error("Could not rasterize the QR code."));
		};
		image.src = objectUrl;
	});
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("QR PNG generation failed.")), "image/png"));
}

function decodeQr(canvas: HTMLCanvasElement): string | null {
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) return null;
	const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
	return jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw new DOMException("QR generation cancelled.", "AbortError");
}

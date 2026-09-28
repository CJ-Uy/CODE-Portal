import type { CornerDotType, CornerSquareType, DotType } from "qr-code-styling";
import type { QrStyle } from "@/db/repositories/links";

export const CODE_NAVY = "#06192F";
export const CODE_WHITE = "#FFFFFF";
export const CODE_LOGO = "/code-falcon-transparent.svg";
export const CODE_LOGO_WHITE = "/code-falcon-white.svg";

export const QR_PATTERNS = [
	{ value: "classic", label: "Classic", dots: "square" },
	{ value: "rounded", label: "Rounded", dots: "rounded" },
	{ value: "dots", label: "Dots", dots: "dots" },
	{ value: "soft", label: "Soft", dots: "extra-rounded" },
	{ value: "classy", label: "Classy", dots: "classy" },
	{ value: "classy-rounded", label: "Classy rounded", dots: "classy-rounded" },
] as const satisfies ReadonlyArray<{ value: QrStyle["pattern"]; label: string; dots: DotType }>;

export const QR_CORNERS = [
	{ value: "square", label: "Square", frame: "square", eye: "square" },
	{ value: "rounded", label: "Rounded", frame: "extra-rounded", eye: "dot" },
	{ value: "dot", label: "Dot", frame: "dot", eye: "dot" },
] as const satisfies ReadonlyArray<{
	value: QrStyle["cornerStyle"];
	label: string;
	frame: CornerSquareType;
	eye: CornerDotType;
}>;

export const QR_LOGO_SIZES = [
	{ value: 0.16, label: "Small" },
	{ value: 0.2, label: "Compact" },
	{ value: 0.24, label: "Standard" },
	{ value: 0.28, label: "Large" },
	{ value: 0.32, label: "Extra large" },
] as const;

export const QR_EXPORT_SIZES = [512, 1024, 2048] as const;

export const ORG_QR_STYLE: QrStyle = {
	foreground: CODE_NAVY,
	background: CODE_WHITE,
	pattern: "classic",
	cornerStyle: "square",
	showLogo: true,
	logoUrl: CODE_LOGO,
	logoSize: 0.24,
	logoMargin: 8,
	showLogoBacking: false,
	logoBackingShape: "circle",
	logoBackingColor: CODE_WHITE,
	transparentBackground: false,
};

export function normalizeQrStyle(style?: Partial<QrStyle>): QrStyle {
	const merged = { ...ORG_QR_STYLE, ...(style ?? {}) };
	const pattern = QR_PATTERNS.some((option) => option.value === merged.pattern) ? merged.pattern : ORG_QR_STYLE.pattern;
	const cornerStyle = QR_CORNERS.some((option) => option.value === merged.cornerStyle) ? merged.cornerStyle : ORG_QR_STYLE.cornerStyle;
	const requestedLogoSize = Number.isFinite(merged.logoSize) ? merged.logoSize : ORG_QR_STYLE.logoSize;
	const logoSize = QR_LOGO_SIZES.reduce<number>((closest, option) =>
		Math.abs(option.value - requestedLogoSize) < Math.abs(closest - requestedLogoSize) ? option.value : closest,
	QR_LOGO_SIZES[0].value);
	const logoUrl = merged.logoUrl === null || /^(?:\/(?!\/)|https?:\/\/)/i.test(merged.logoUrl) ? merged.logoUrl : CODE_LOGO;

	return {
		...merged,
		foreground: validHex(merged.foreground) ? merged.foreground : CODE_NAVY,
		background: validHex(merged.background) ? merged.background : CODE_WHITE,
		pattern,
		cornerStyle,
		logoUrl,
		logoSize,
		logoMargin: Number.isFinite(merged.logoMargin) ? Math.min(24, Math.max(0, merged.logoMargin)) : ORG_QR_STYLE.logoMargin,
		showLogo: typeof style?.showLogo === "boolean" ? style.showLogo : logoUrl !== null,
		showLogoBacking: typeof merged.showLogoBacking === "boolean" ? merged.showLogoBacking : ORG_QR_STYLE.showLogoBacking,
		logoBackingShape: merged.logoBackingShape === "square" ? "square" : "circle",
		logoBackingColor: validHex(merged.logoBackingColor) ? merged.logoBackingColor : CODE_WHITE,
		transparentBackground: typeof merged.transparentBackground === "boolean" ? merged.transparentBackground : false,
	};
}

function validHex(value: string): boolean {
	return /^#[\da-f]{6}$/i.test(value);
}

export function qrTrackingUrl(url: string): string {
	try {
		const target = new URL(url);
		target.searchParams.delete("s");
		target.searchParams.set("source", "qr");
		return target.toString();
	} catch {
		return url;
	}
}

export function qrDotType(pattern: QrStyle["pattern"]): DotType {
	return QR_PATTERNS.find((option) => option.value === pattern)?.dots ?? "square";
}

export function qrCornerTypes(cornerStyle: QrStyle["cornerStyle"]): { frame: CornerSquareType; eye: CornerDotType } {
	const corner = QR_CORNERS.find((option) => option.value === cornerStyle) ?? QR_CORNERS[0];
	return { frame: corner.frame, eye: corner.eye };
}

export function qrColorContrast(first: string, second: string): number {
	const luminance = (hex: string) => {
		if (!/^#[\da-f]{6}$/i.test(hex)) return Number.NaN;
		return hex
			.slice(1)
			.match(/../g)!
			.map((value) => parseInt(value, 16) / 255)
			.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
			.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
	};
	const a = luminance(first);
	const b = luminance(second);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export type QrBackgroundMode = "light" | "dark" | "transparent";

export function qrBackgroundMode(style: QrStyle): QrBackgroundMode | "custom" {
	if (style.transparentBackground) return "transparent";
	if (style.foreground.toUpperCase() === CODE_WHITE && style.background.toUpperCase() === CODE_NAVY) return "dark";
	if (style.foreground.toUpperCase() === CODE_NAVY && style.background.toUpperCase() === CODE_WHITE) return "light";
	return "custom";
}

export function withQrBackground(style: QrStyle, mode: QrBackgroundMode): QrStyle {
	const usesOfficialLogo = style.logoUrl === CODE_LOGO || style.logoUrl === CODE_LOGO_WHITE;
	return {
		...style,
		foreground: mode === "dark" ? CODE_WHITE : CODE_NAVY,
		background: mode === "dark" ? CODE_NAVY : CODE_WHITE,
		transparentBackground: mode === "transparent",
		logoUrl: usesOfficialLogo ? (mode === "dark" && !style.showLogoBacking ? CODE_LOGO_WHITE : CODE_LOGO) : style.logoUrl,
	};
}

export function isSelfContainedQrSvg(svg: string): boolean {
	return !/(?:href|xlink:href)=["'](?:https?:|blob:|\/)/i.test(svg);
}

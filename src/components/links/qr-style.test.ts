import { describe, expect, it } from "vitest";
import {
	CODE_LOGO,
	ORG_QR_STYLE,
	QR_CORNERS,
	QR_LOGO_SIZES,
	QR_PATTERNS,
	isSelfContainedQrSvg,
	normalizeQrStyle,
	qrColorContrast,
	qrCornerTypes,
	qrDotType,
	qrTrackingUrl,
	withQrBackground,
} from "./qr-style";

describe("short-link QR style", () => {
	it("keeps legacy styles safe and emits one canonical QR marker", () => {
		const target = qrTrackingUrl("https://code.example/go?campaign=fall&s=qr&s=old&source=link&source=email#signup");
		const parsed = new URL(target);
		expect(parsed.searchParams.get("campaign")).toBe("fall");
		expect(parsed.searchParams.getAll("s")).toEqual([]);
		expect(parsed.searchParams.getAll("source")).toEqual(["qr"]);
		expect(parsed.hash).toBe("#signup");

		const legacy = normalizeQrStyle({
			foreground: "#112233",
			background: "#ffffff",
			logoUrl: null,
			logoSize: 0.27,
			logoMargin: 4,
			showLogoBacking: true,
		});
		expect(legacy).toMatchObject({ pattern: "classic", cornerStyle: "square", showLogo: false, logoSize: 0.28 });
		expect(normalizeQrStyle({ logoBackingColor: '\"><script>', logoUrl: "javascript:alert(1)" })).toMatchObject({ logoBackingColor: "#FFFFFF", logoUrl: CODE_LOGO });
		expect(QR_PATTERNS.map((option) => qrDotType(option.value))).toHaveLength(6);
		expect(new Set(QR_PATTERNS.map((option) => qrDotType(option.value))).size).toBe(6);
		expect(new Set(QR_CORNERS.map((option) => JSON.stringify(qrCornerTypes(option.value)))).size).toBe(3);
		expect(QR_LOGO_SIZES).toHaveLength(5);
		expect(qrColorContrast(ORG_QR_STYLE.foreground, ORG_QR_STYLE.background)).toBeGreaterThanOrEqual(4.5);
		expect(withQrBackground(ORG_QR_STYLE, "dark")).toMatchObject({ foreground: "#FFFFFF", background: "#06192F", transparentBackground: false });
		expect(withQrBackground(ORG_QR_STYLE, "transparent")).toMatchObject({ foreground: "#06192F", background: "#FFFFFF", transparentBackground: true, logoUrl: CODE_LOGO });
		expect(isSelfContainedQrSvg('<svg><image href="data:image/png;base64,abc" /></svg>')).toBe(true);
		expect(isSelfContainedQrSvg('<svg><image href="https://example.com/logo.png" /></svg>')).toBe(false);
	});
});

import { isCheckinToken } from "./checkin-token";
import { decodeMemberCode } from "./member-code";

export type ScanState = "idle" | "success" | "duplicate" | "invalid" | "error";

export type ScanClassification =
	| { kind: "member"; memberId: string }
	| { kind: "token"; token: string }
	| { kind: "invalid" };

export type ScanResponse = {
	eventId: string;
	memberId: string;
	memberName: string | null;
	memberImage: string | null;
	scannedAt: Date;
	scannedByName: string | null;
	alreadyPresent: boolean;
};

export type ScanDescription = { state: ScanState; title: string; detail: string };

/** Decides what a decoded QR is before any network call, so bad QRs fail instantly. */
export function classifyScan(raw: string): ScanClassification {
	const value = raw.trim();
	if (isCheckinToken(value)) return { kind: "token", token: value };
	const memberId = decodeMemberCode(value);
	if (memberId) return { kind: "member", memberId };
	return { kind: "invalid" };
}

function agoLabel(from: Date, now: Date): string {
	const minutes = Math.floor((now.getTime() - from.getTime()) / 60000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	return hours < 24 ? `${hours} hr ago` : `${Math.floor(hours / 24)} d ago`;
}

export function describeScan(response: ScanResponse, now: Date): ScanDescription {
	const title = response.memberName ?? response.memberId;
	if (!response.alreadyPresent) return { state: "success", title, detail: "Marked present" };
	const when = agoLabel(response.scannedAt, now);
	const by = response.scannedByName ? ` by ${response.scannedByName}` : "";
	return { state: "duplicate", title, detail: `Already scanned ${when}${by}` };
}

/**
 * iOS Safari never advertises torch through getUserMedia, so the control must be
 * capability-gated rather than feature-detected on the browser.
 */
export function supportsTorch(track: MediaStreamTrack | undefined): boolean {
	const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined;
	return capabilities?.torch === true;
}

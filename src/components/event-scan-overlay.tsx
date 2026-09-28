"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, History, SwitchCamera, Undo2, X, XCircle, Zap, ZapOff } from "lucide-react";
import { CameraScanner, type CameraFacingMode, type CameraScannerControls } from "@/components/camera-scanner";
import { formatUtc8Time } from "@/lib/date-slots";
import { classifyScan, describeScan, type ScanDescription, type ScanResponse } from "@/lib/scan-feedback";
import { cn } from "@/lib/utils";

type LogEntry = ScanDescription & { at: Date };
type BannerState = Exclude<ScanDescription["state"], "idle">;

const BANNER_STYLE: Record<BannerState, string> = {
	success: "border-emerald-400 bg-emerald-600/90",
	duplicate: "border-amber-400 bg-amber-600/90",
	invalid: "border-red-400 bg-red-600/90",
	error: "border-red-400 bg-red-600/90",
};

const BANNER_ICON: Record<BannerState, typeof CheckCircle2> = {
	success: CheckCircle2,
	duplicate: AlertTriangle,
	invalid: XCircle,
	error: XCircle,
};

export function EventScanOverlay({
	eventId,
	termId,
	canUndo,
	onClose,
}: {
	eventId: string;
	termId: string;
	canUndo: boolean;
	onClose: () => void;
}) {
	const [facingMode, setFacingMode] = useState<CameraFacingMode>("environment");
	const [controls, setControls] = useState<CameraScannerControls | null>(null);
	const [result, setResult] = useState<ScanDescription>({ state: "idle", title: "", detail: "" });
	const [memberImage, setMemberImage] = useState<string | null>(null);
	const [count, setCount] = useState(0);
	const [lastMemberId, setLastMemberId] = useState<string | null>(null);
	const [log, setLog] = useState<LogEntry[]>([]);
	const [logOpen, setLogOpen] = useState(false);
	// ponytail: three oscillator blips beat shipping and decoding audio assets.
	const audioRef = useRef<AudioContext | null>(null);

	// Transient banners (duplicate/invalid/error) clear themselves so a stale result doesn't
	// sit forever between scans. A fresh success stays up so its Undo button stays reachable.
	useEffect(() => {
		if (result.state !== "duplicate" && result.state !== "invalid" && result.state !== "error") return;
		const timer = setTimeout(() => setResult({ state: "idle", title: "", detail: "" }), 2000);
		return () => clearTimeout(timer);
	}, [result]);

	useEffect(
		() => () => {
			void audioRef.current?.close();
		},
		[],
	);

	function play(kind: "success" | "duplicate" | "invalid") {
		if (typeof window === "undefined") return;
		navigator.vibrate?.(kind === "success" ? 60 : [40, 60, 40]);
		try {
			// Created on the first gesture — browsers block AudioContext before that.
			const context = (audioRef.current ??= new AudioContext());
			const tones = { success: [880], duplicate: [520, 520], invalid: [180] }[kind];
			tones.forEach((frequency, index) => {
				const oscillator = context.createOscillator();
				const gain = context.createGain();
				oscillator.frequency.value = frequency;
				gain.gain.value = 0.08;
				oscillator.connect(gain).connect(context.destination);
				const start = context.currentTime + index * 0.18;
				oscillator.start(start);
				oscillator.stop(start + 0.12);
			});
		} catch {
			// Audio is a nicety; vibration and the banner already reported the result.
		}
	}

	async function handleCode(raw: string) {
		const classified = classifyScan(raw);
		if (classified.kind === "invalid") {
			setMemberImage(null);
			setResult({ state: "invalid", title: "Not a CODE member QR code", detail: "Ask them to open their member code." });
			play("invalid");
			return;
		}
		const body = classified.kind === "member" ? { memberId: classified.memberId } : { token: classified.token };
		try {
			const response = await fetch(`/api/events/${eventId}/scan`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...body, termId }),
			});
			if (!response.ok) {
				const error = (await response.json().catch(() => null)) as { error?: string } | null;
				setMemberImage(null);
				setResult({ state: "error", title: "Scan failed", detail: error?.error ?? "Use the search instead." });
				play("invalid");
				return;
			}
			const raw2 = (await response.json()) as Omit<ScanResponse, "scannedAt"> & { scannedAt: string };
			const parsed: ScanResponse = { ...raw2, scannedAt: new Date(raw2.scannedAt) };
			const described = describeScan(parsed, new Date());
			setResult(described);
			setMemberImage(parsed.memberImage);
			setLastMemberId(parsed.memberId);
			if (!parsed.alreadyPresent) setCount((value) => value + 1);
			setLog((entries) => [{ ...described, at: new Date() }, ...entries].slice(0, 50));
			play(described.state === "success" ? "success" : "duplicate");
		} catch {
			setMemberImage(null);
			setResult({ state: "error", title: "Scan failed", detail: "Check your connection and try again." });
			play("invalid");
		}
	}

	async function undoLast() {
		if (!lastMemberId) return;
		try {
			const response = await fetch(`/api/events/${eventId}/scan`, {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ memberId: lastMemberId }),
			});
			if (!response.ok) {
				const error = (await response.json().catch(() => null)) as { error?: string } | null;
				setResult({ state: "error", title: "Undo failed", detail: error?.error ?? "Try again or use the search instead." });
				play("invalid");
				return;
			}
			const { removed } = (await response.json()) as { removed: boolean };
			if (removed) setCount((value) => Math.max(0, value - 1));
			setResult({ state: "idle", title: "", detail: "" });
			setLastMemberId(null);
			setMemberImage(null);
		} catch {
			setResult({ state: "error", title: "Undo failed", detail: "Check your connection and try again." });
			play("invalid");
		}
	}

	const bannerState = result.state;
	const BannerIcon = bannerState === "idle" ? null : BANNER_ICON[bannerState];

	return (
		<div className="fixed inset-0 z-50 flex flex-col overscroll-none bg-black text-white" style={{ height: "100dvh" }}>
			<div
				className="flex items-center justify-between gap-2 px-3 pb-2"
				style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
			>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close scanner"
					className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 backdrop-blur"
				>
					<X className="size-5" />
				</button>
				<div className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-sm font-medium backdrop-blur">
					Scanned {count}
				</div>
				<div className="flex items-center gap-2">
					{controls?.torchAvailable ? (
						<button
							type="button"
							onClick={() => void controls.toggleTorch()}
							aria-label={controls.torchOn ? "Turn off flashlight" : "Turn on flashlight"}
							className={cn(
								"inline-flex size-10 items-center justify-center rounded-full backdrop-blur",
								controls.torchOn ? "bg-amber-400 text-black" : "bg-white/10",
							)}
						>
							{controls.torchOn ? <Zap className="size-5" /> : <ZapOff className="size-5" />}
						</button>
					) : null}
					<button
						type="button"
						onClick={() => setFacingMode((mode) => (mode === "environment" ? "user" : "environment"))}
						aria-label="Flip camera"
						className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 backdrop-blur"
					>
						<SwitchCamera className="size-5" />
					</button>
					<button
						type="button"
						onClick={() => setLogOpen(true)}
						aria-label="Recent scans"
						className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 backdrop-blur"
					>
						<History className="size-5" />
					</button>
				</div>
			</div>

			<div className="relative min-h-0 flex-1">
				<CameraScanner onCode={handleCode} facingMode={facingMode} onControls={setControls} className="h-full w-full">
					<div
						className="pointer-events-none absolute inset-x-12 top-1/2 aspect-square -translate-y-1/2 rounded-2xl border-2 border-white/70"
						aria-hidden
					/>
				</CameraScanner>
			</div>

			<div className="px-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
				{bannerState !== "idle" && BannerIcon ? (
					<div className={cn("flex items-center gap-3 rounded-2xl border p-3 shadow-lg", BANNER_STYLE[bannerState])}>
						{memberImage ? (
							// eslint-disable-next-line @next/next/no-img-element
							<img src={memberImage} alt="" className="size-10 shrink-0 rounded-full object-cover" />
						) : (
							<BannerIcon className="size-8 shrink-0" />
						)}
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-semibold">{result.title}</p>
							<p className="truncate text-xs text-white/90">{result.detail}</p>
						</div>
						{bannerState === "success" && canUndo ? (
							<button
								type="button"
								onClick={() => void undoLast()}
								className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/30 px-3 py-1.5 text-xs font-medium"
							>
								<Undo2 className="size-3.5" />
								Undo
							</button>
						) : null}
					</div>
				) : (
					<div className="rounded-2xl border border-white/20 bg-white/5 p-3 text-center text-sm text-white/70">
						Point the camera at a member&rsquo;s QR code
					</div>
				)}
			</div>

			{logOpen ? (
				<div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/60" onClick={() => setLogOpen(false)}>
					<div
						className="max-h-[70vh] overflow-y-auto rounded-t-2xl bg-neutral-900 p-4"
						style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
						onClick={(event) => event.stopPropagation()}
					>
						<div className="mb-3 flex items-center justify-between">
							<p className="text-sm font-semibold">Recent scans</p>
							<button
								type="button"
								onClick={() => setLogOpen(false)}
								aria-label="Close recent scans"
								className="text-white/70"
							>
								<X className="size-5" />
							</button>
						</div>
						{log.length === 0 ? (
							<p className="text-sm text-white/60">No scans yet.</p>
						) : (
							<ul className="flex flex-col gap-2">
								{log.map((entry, index) => (
									<li
										key={`${entry.title}-${entry.at.getTime()}-${index}`}
										className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm"
									>
										<span className="truncate">{entry.title}</span>
										<span className="shrink-0 text-xs text-white/60">
											{formatUtc8Time(entry.at)}
										</span>
									</li>
								))}
							</ul>
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}

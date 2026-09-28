"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import jsQR from "jsqr";
import { canUseCameraScanner } from "@/lib/camera-scanner-support";
import { supportsTorch } from "@/lib/scan-feedback";
import { cn } from "@/lib/utils";

// BarcodeDetector is a native browser API not yet in the TS DOM lib.
type DetectedBarcode = { rawValue: string };
type Detector = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
declare global {
	interface Window {
		BarcodeDetector?: new (opts?: { formats?: string[] }) => Detector;
	}
}

export type CameraFacingMode = "environment" | "user";
export type CameraScannerControls = { torchAvailable: boolean; torchOn: boolean; toggleTorch: () => void };

export function CameraScanner({
	onCode,
	facingMode = "environment",
	className,
	children,
	onControls,
}: {
	onCode: (code: string) => void | Promise<void>;
	facingMode?: CameraFacingMode;
	className?: string;
	children?: ReactNode;
	onControls?: (controls: CameraScannerControls) => void;
}) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const onCodeRef = useRef(onCode);
	const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const trackRef = useRef<MediaStreamTrack | undefined>(undefined);
	const inFlightRef = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const [torchOn, setTorchOn] = useState(false);
	const [torchAvailable, setTorchAvailable] = useState(false);

	useEffect(() => {
		onCodeRef.current = onCode;
	}, [onCode]);

	const supported = canUseCameraScanner();

	useEffect(() => {
		if (!supported) return;
		let stream: MediaStream | null = null;
		let raf = 0;
		let cancelled = false;
		let detector: Detector | null = null;
		try {
			detector = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
		} catch {
			// Some browsers expose BarcodeDetector without QR support. jsQR remains the fallback.
		}

		async function loop() {
			const video = videoRef.current;
			if (cancelled || !video) return;
			try {
				const code = detector ? (await detector.detect(video))[0]?.rawValue : scanWithJsQr(video);
				if (code) {
					const now = Date.now();
					// Debounce: one badge held in front of the camera marks once, not every frame.
					if (code !== lastRef.current.code || now - lastRef.current.at > 2500) {
						// One badge held in frame must not fire two concurrent requests.
						if (!inFlightRef.current) {
							lastRef.current = { code, at: now };
							inFlightRef.current = true;
							try {
								await onCodeRef.current(code);
							} finally {
								inFlightRef.current = false;
							}
						}
					}
				}
			} catch {
				// frame not ready yet — keep scanning
			}
			raf = requestAnimationFrame(loop);
		}

		function scanWithJsQr(video: HTMLVideoElement) {
			if (!video.videoWidth || !video.videoHeight) return null;
			const canvas = (canvasRef.current ??= document.createElement("canvas"));
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
			const ctx = canvas.getContext("2d", { willReadFrequently: true });
			if (!ctx) return null;
			ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
			const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
			return jsQR(frame.data, frame.width, frame.height)?.data ?? null;
		}

		(async () => {
			try {
				stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
				if (cancelled) {
					stream.getTracks().forEach((track) => track.stop());
					return;
				}
				const video = videoRef.current;
				if (!video) {
					stream.getTracks().forEach((track) => track.stop());
					return;
				}
				video.srcObject = stream;
				await video.play();
				setError(null);
				const track = stream.getVideoTracks()[0];
				trackRef.current = track;
				setTorchAvailable(supportsTorch(track));
				loop();
			} catch {
				if (!cancelled) setError("Camera access was blocked. Close the scanner and use member search.");
			}
		})();

		return () => {
			cancelled = true;
			cancelAnimationFrame(raf);
			// Always stop tracks on unmount/facing-mode change — a leaked stream leaves the camera light on.
			stream?.getTracks().forEach((track) => track.stop());
			trackRef.current = undefined;
			setTorchAvailable(false);
			setTorchOn(false);
		};
	}, [supported, facingMode]);

	const toggleTorch = useCallback(async () => {
		const track = trackRef.current;
		if (!track) return;
		const next = !torchOn;
		try {
			// `torch` isn't in the standard MediaTrackConstraintSet lib types yet.
			await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints);
			setTorchOn(next);
		} catch {
			setTorchAvailable(false);
		}
	}, [torchOn]);

	useEffect(() => {
		onControls?.({ torchAvailable, torchOn, toggleTorch });
	}, [torchAvailable, torchOn, toggleTorch, onControls]);

	if (!supported) {
		return (
			<p className="text-xs text-muted-foreground">
				Camera scanning isn’t supported on this browser. Close the scanner and use member search.
			</p>
		);
	}

	return (
		<div className={cn("relative h-full w-full overflow-hidden bg-black", className)}>
			<video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted />
			{children}
			{error ? (
				<p className="absolute inset-x-4 bottom-4 rounded-md bg-black/70 px-3 py-2 text-center text-xs text-white">
					{error}
				</p>
			) : null}
		</div>
	);
}

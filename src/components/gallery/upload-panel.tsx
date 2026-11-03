"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, RotateCcw, X } from "lucide-react";
import { formatBytes, LARGE_UPLOAD_BYTES } from "@/lib/gallery/view";
import { cn } from "@/lib/utils";
import { uploadGalleryFile } from "./uploader";

type Upload = { id: number; file: File; folderId: string | null; status: "waiting" | "uploading" | "done" | "failed"; progress: number; error?: string };

const CONCURRENT = 3;

/**
 * The upload queue: three files at a time, each in parts, refreshing the page as they land. Closing the tab
 * mid-upload asks first, since a half-sent file is lost.
 */
export function useUploadQueue() {
	const router = useRouter();
	const [uploads, setUploads] = useState<Upload[]>([]);
	const nextId = useRef(1);
	const running = useRef(new Set<number>());
	const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const patch = useCallback((id: number, change: Partial<Upload>) => setUploads((list) => list.map((upload) => (upload.id === id ? { ...upload, ...change } : upload))), []);

	const add = useCallback((files: File[], folderId: string | null) => {
		setUploads((list) => [...list, ...files.map((file) => ({ id: nextId.current++, file, folderId, status: "waiting" as const, progress: 0 }))]);
	}, []);

	const retry = useCallback((id: number) => patch(id, { status: "waiting", progress: 0, error: undefined }), [patch]);
	const clearFinished = useCallback(() => setUploads((list) => list.filter((upload) => upload.status !== "done" && upload.status !== "failed")), []);

	useEffect(() => {
		const free = CONCURRENT - running.current.size;
		for (const upload of uploads.filter((candidate) => candidate.status === "waiting" && !running.current.has(candidate.id)).slice(0, Math.max(0, free))) {
			running.current.add(upload.id);
			patch(upload.id, { status: "uploading" });
			uploadGalleryFile(upload.file, { folderId: upload.folderId, onProgress: (progress) => patch(upload.id, { progress }) })
				.then(() => {
					patch(upload.id, { status: "done", progress: 1 });
					// One refresh for a burst of finished files, not one per file.
					if (refreshTimer.current) clearTimeout(refreshTimer.current);
					refreshTimer.current = setTimeout(() => router.refresh(), 600);
				})
				.catch((error: unknown) => patch(upload.id, { status: "failed", error: error instanceof Error ? error.message : "Upload failed." }))
				.finally(() => running.current.delete(upload.id));
		}
	}, [uploads, patch, router]);

	const active = uploads.some((upload) => upload.status === "waiting" || upload.status === "uploading");
	useEffect(() => {
		if (!active) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [active]);

	return { uploads, add, retry, clearFinished, active };
}

/** `viewHref` adds a link to where the files went, for pages that upload somewhere else (the front page). */
export function UploadPanel({ queue, viewHref }: { queue: ReturnType<typeof useUploadQueue>; viewHref?: string }) {
	const [collapsed, setCollapsed] = useState(false);
	const { uploads } = queue;
	if (uploads.length === 0) return null;
	const done = uploads.filter((upload) => upload.status === "done").length;
	const failed = uploads.filter((upload) => upload.status === "failed").length;
	const large = uploads.filter((upload) => upload.status !== "done" && upload.file.size > LARGE_UPLOAD_BYTES);
	const title = queue.active ? `${done} of ${uploads.length} uploaded` : failed ? `${failed} ${failed === 1 ? "upload" : "uploads"} failed` : `Uploaded ${done} ${done === 1 ? "file" : "files"}`;

	return (
		<section
			aria-label="Uploads"
			className="fixed inset-x-3 bottom-24 z-40 overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-[0_12px_32px_-8px_rgba(6,25,47,0.35)] sm:inset-x-auto sm:right-6 sm:w-96 md:bottom-6"
		>
			<header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
				<p className="flex-1 text-sm font-semibold" aria-live="polite">
					{title}
				</p>
				{viewHref && !queue.active && done ? (
					<Link href={viewHref} className="text-sm font-medium text-accent underline-offset-4 hover:underline">
						View album
					</Link>
				) : null}
				<button type="button" onClick={() => setCollapsed((value) => !value)} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={collapsed ? "Show uploads" : "Hide uploads"} aria-expanded={!collapsed}>
					<ChevronDown className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
				</button>
				{!queue.active ? (
					<button type="button" onClick={queue.clearFinished} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Close uploads">
						<X className="size-4" />
					</button>
				) : null}
			</header>
			{!collapsed ? (
				<>
					{large.length ? (
						<p className="flex gap-2 border-b border-border bg-secondary/50 px-4 py-2 text-xs leading-relaxed text-secondary-foreground">
							<AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
							<span>
								{large.length === 1 ? `${large[0].file.name} is ${formatBytes(large[0].file.size)}.` : `${large.length} files are over 1 GB.`} Large files take a while. Keep this page open until they finish.
							</span>
						</p>
					) : null}
					<ul className="max-h-72 divide-y divide-border overflow-y-auto">
						{uploads.map((upload) => (
							<li key={upload.id} className="grid gap-1.5 px-4 py-2.5">
								<div className="flex min-w-0 items-center gap-2 text-sm">
									<span className="min-w-0 flex-1 truncate">{upload.file.name}</span>
									<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
										{upload.status === "uploading" ? `${Math.floor(upload.progress * 100)}%` : formatBytes(upload.file.size)}
									</span>
									{upload.status === "done" ? <Check className="size-4 shrink-0 text-accent" aria-label="Uploaded" /> : null}
									{upload.status === "failed" ? (
										<button type="button" onClick={() => queue.retry(upload.id)} className="inline-flex shrink-0 items-center gap-1 rounded text-xs font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
											<RotateCcw className="size-3" aria-hidden />
											Retry
										</button>
									) : null}
								</div>
								{upload.status === "failed" ? (
									<p className="text-xs text-muted-foreground">{upload.error}</p>
								) : upload.status !== "done" ? (
									<div className="h-1 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(upload.progress * 100)} aria-label={`Uploading ${upload.file.name}`}>
										<div className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out" style={{ width: `${Math.max(2, upload.progress * 100)}%` }} />
									</div>
								) : null}
							</li>
						))}
					</ul>
				</>
			) : null}
		</section>
	);
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SaveState = "idle" | "saving" | "saved" | "error";

/** Saves `value` 1.2 s after the last change. Skips the first render so opening a page never writes. */
export function useAutosave<T>(value: T, save: (value: T) => Promise<boolean>, delay = 1200) {
	const [state, setState] = useState<SaveState>("idle");
	const first = useRef(true);
	const latest = useRef(value);
	const saveRef = useRef(save);
	const dirty = useRef(false);

	useEffect(() => {
		latest.current = value;
		saveRef.current = save;
	});

	const flush = useCallback(async () => {
		if (!dirty.current) return true;
		dirty.current = false;
		setState("saving");
		const ok = await saveRef.current(latest.current);
		setState(ok ? "saved" : "error");
		if (!ok) dirty.current = true;
		return ok;
	}, []);

	useEffect(() => {
		if (first.current) {
			first.current = false;
			return;
		}
		dirty.current = true;
		const timer = window.setTimeout(() => void flush(), delay);
		return () => window.clearTimeout(timer);
	}, [value, delay, flush]);

	return { state, flush };
}

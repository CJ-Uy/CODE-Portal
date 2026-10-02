"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Saves `value` 1.2 s after the last change. Skips the first render so opening a page never writes.
 * Saves never overlap: a change during a save triggers one trailing save after it resolves.
 * `flush(fresh)` saves now (pass the freshest value; the hook's own copy lags one effect behind) and
 * also runs when the component unmounts with unsaved changes.
 */
export function useAutosave<T>(value: T, save: (value: T) => Promise<boolean>, delay = 1200) {
	const [state, setState] = useState<SaveState>("idle");
	const first = useRef(true);
	const latest = useRef(value);
	const saveRef = useRef(save);
	const dirty = useRef(false);
	const running = useRef<Promise<boolean> | null>(null);

	useEffect(() => {
		latest.current = value;
		saveRef.current = save;
	});

	const flush = useCallback((fresh?: T) => {
		if (fresh !== undefined) latest.current = fresh;
		if (running.current) return running.current; // its loop picks up anything still dirty
		if (!dirty.current) return Promise.resolve(true);
		const run = (async () => {
			let ok = true;
			setState("saving");
			try {
				while (dirty.current) {
					dirty.current = false;
					ok = await saveRef.current(latest.current);
					if (!ok) {
						dirty.current = true;
						break;
					}
				}
			} catch {
				ok = false;
				dirty.current = true;
			}
			setState(ok ? "saved" : "error");
			return ok;
		})();
		running.current = run;
		void run.then(() => {
			running.current = null;
		});
		return run;
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

	useEffect(() => () => void flush(), [flush]);

	return { state, flush };
}

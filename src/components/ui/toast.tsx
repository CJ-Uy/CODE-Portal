"use client";

import { createContext, useCallback, useContext, useState } from "react";

type ToastInput = { message: string; action?: { label: string; onClick: () => void } };
type Toast = ToastInput & { id: number };

const ToastContext = createContext<(toast: ToastInput) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const dismiss = useCallback((id: number) => setToasts((current) => current.filter((t) => t.id !== id)), []);
	const show = useCallback(
		(toast: ToastInput) => {
			const id = Date.now() + Math.random();
			setToasts((current) => [...current.slice(-2), { ...toast, id }]);
			window.setTimeout(() => dismiss(id), toast.action ? 6000 : 4000);
		},
		[dismiss],
	);
	return (
		<ToastContext.Provider value={show}>
			{children}
			<div
				aria-live="polite"
				className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6"
			>
				{toasts.map((toast) => (
					<div
						key={toast.id}
						className="toast-enter pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg"
					>
						<span className="min-w-0 flex-1 break-all sm:break-normal">{toast.message}</span>
						{toast.action ? (
							<button
								type="button"
								className="shrink-0 rounded font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
								onClick={() => {
									toast.action?.onClick();
									dismiss(toast.id);
								}}
							>
								{toast.action.label}
							</button>
						) : null}
					</div>
				))}
			</div>
		</ToastContext.Provider>
	);
}

export const useToast = () => useContext(ToastContext);

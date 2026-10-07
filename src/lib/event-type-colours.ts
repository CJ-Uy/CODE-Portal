/**
 * Event type colours are stored as a token, not a hex value: Tailwind classes cannot be
 * generated at runtime, and a fixed palette guarantees legibility in light and dark mode.
 */
export const eventTypeColours = ["primary", "accent", "emerald", "amber", "rose", "slate"] as const;

export type EventTypeColour = (typeof eventTypeColours)[number];

const CLASSES: Record<EventTypeColour, { chip: string; dot: string }> = {
	primary: { chip: "bg-primary/10 text-foreground", dot: "bg-primary" },
	accent: { chip: "bg-accent/15 text-foreground", dot: "bg-accent" },
	emerald: { chip: "bg-emerald-500/15 text-foreground", dot: "bg-emerald-500" },
	amber: { chip: "bg-amber-500/15 text-foreground", dot: "bg-amber-500" },
	rose: { chip: "bg-rose-500/15 text-foreground", dot: "bg-rose-500" },
	slate: { chip: "bg-slate-500/15 text-foreground", dot: "bg-slate-500" },
};

/** Unknown tokens degrade to slate. Falling back visually is safe; permission checks still fail closed. */
export function colourClasses(token: string): { chip: string; dot: string } {
	return CLASSES[token as EventTypeColour] ?? CLASSES.slate;
}

/** SVG charts use the same theme colors as event chips. */
export function colourValue(token: string): string {
	const values: Record<EventTypeColour, string> = {
		primary: "var(--primary)", accent: "var(--accent)", emerald: "var(--color-emerald-500)",
		amber: "var(--color-amber-500)", rose: "var(--color-rose-500)", slate: "var(--color-slate-500)",
	};
	return values[token as EventTypeColour] ?? values.slate;
}

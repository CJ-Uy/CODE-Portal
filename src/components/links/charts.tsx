"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { hitZones, stepIndex } from "./chart-geometry";
import { formatStatsPoint } from "./stats-utils";

type Point = { date: string; count: number };
type Bucket = { bucket: string; count: number };

function maxCount(rows: Array<{ count: number }>): number {
	return Math.max(1, ...rows.map((row) => row.count));
}

function niceTicks(max: number): number[] {
	if (max <= 2) return [...new Set([max, Math.max(1, Math.round(max / 2)), 0])];
	const step = Math.max(1, Math.ceil(max / 2));
	return [step * 2, step, 0];
}

// Turn stored bucket tokens (direct, qr scan, mobile, …) into friendly display labels.
export function formatBucket(bucket: string): string {
	if (bucket === "qr scan") return "QR code scanned";
	if (bucket === "direct") return "Direct link";
	if (bucket === "unknown") return "Unknown history";
	return bucket.charAt(0).toUpperCase() + bucket.slice(1);
}

function ChartEmpty({ children }: { children: string }) {
	return <p className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function clickLabel(count: number): string {
	return `${count} ${count === 1 ? "click" : "clicks"}`;
}

/**
 * Drawn inside the SVG rather than as an HTML overlay. The chart scales with
 * preserveAspectRatio, so an HTML tooltip would need the letterboxing offset back out of
 * the viewBox units; staying in SVG space means the anchor is already correct.
 */
function ChartTooltip({ x, y, heading, value, chartWidth }: { x: number; y: number; heading: string; value: string; chartWidth: number }) {
	const boxWidth = Math.max(heading.length, value.length) * 6.4 + 18;
	const boxHeight = 38;
	// Flip across the anchor near the edges so the box never leaves the plot.
	const left = Math.min(Math.max(x - boxWidth / 2, 4), chartWidth - boxWidth - 4);
	const top = y - boxHeight - 12 < 4 ? y + 14 : y - boxHeight - 12;
	return (
		<g pointerEvents="none">
			<rect x={left} y={top} width={boxWidth} height={boxHeight} rx="6" className="fill-popover stroke-border" strokeWidth="1" />
			<text x={left + 9} y={top + 15} className="fill-muted-foreground text-[10px]">{heading}</text>
			<text x={left + 9} y={top + 29} className="fill-popover-foreground text-[12px] font-semibold">{value}</text>
		</g>
	);
}

export function ClicksOverTime({ data, average, cumulative = false, verbose = false }: { data: Point[]; average?: number; cumulative?: boolean; verbose?: boolean }) {
	// Hooks run before the empty-data bail so the hook order stays stable across renders.
	const [hovered, setHovered] = useState<number | null>(null);
	if (!data.length) return <ChartEmpty>No clicks tracked yet.</ChartEmpty>;
	const width = 720;
	const height = verbose ? 260 : 180;
	const pad = { top: 18, right: 18, bottom: verbose ? 36 : 16, left: verbose ? 42 : 0 };
	let running = 0;
	const visibleData = cumulative ? data.map((row) => ({ ...row, count: (running += row.count) })) : data;
	// One data point cannot draw a line, so flatten it into a level segment.
	const rows = visibleData.length === 1 ? [visibleData[0], visibleData[0]] : visibleData;
	const max = maxCount(rows);
	const plotWidth = width - pad.left - pad.right;
	const plotHeight = height - pad.top - pad.bottom;
	const baseline = height - pad.bottom;
	const points = rows.map((row, index) => {
		const x = pad.left + (rows.length === 1 ? plotWidth / 2 : (index / (rows.length - 1)) * plotWidth);
		const y = baseline - (row.count / max) * plotHeight;
		return { ...row, x, y, key: `${row.date}-${index}` };
	});
	const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
	const area = `${line} L${points[points.length - 1].x.toFixed(1)},${baseline} L${points[0].x.toFixed(1)},${baseline} Z`;
	const ticks = niceTicks(max);
	const barWidth = Math.max(3, Math.min(18, plotWidth / Math.max(1, visibleData.length) - 2));
	const averageY = average && average > 0 ? baseline - (Math.min(average, max) / max) * plotHeight : null;
	const labelIndexes = Array.from(new Set([0, Math.floor((visibleData.length - 1) / 2), visibleData.length - 1])).filter((index) => index >= 0);
	const recent = visibleData.slice(-Math.min(6, visibleData.length));

	// A lone datum was doubled into a flat segment above, so collapse it back to the single
	// centred marker the chart actually draws. Otherwise hovering would offer two hit zones
	// for one value.
	const markers = visibleData.length === 1 ? [{ ...points[0], x: pad.left + plotWidth / 2 }] : points;
	const zones = hitZones(markers.map((marker) => marker.x), pad.left, width - pad.right);
	const active = hovered !== null && hovered >= 0 && hovered < markers.length ? markers[hovered] : null;

	function step(delta: number) {
		setHovered((current) => stepIndex(current, delta, markers.length));
	}
	return (
		<div className="grid gap-3">
			<div className="relative overflow-x-auto rounded-md border bg-card p-3 text-primary">
				<svg
					viewBox={`0 0 ${width} ${height}`}
					role="img"
					// The label carries the focused value so a screen reader announces each point
					// as the arrow keys move through them, not just a static chart title.
					aria-label={
						active
							? `Clicks over time. ${formatStatsPoint(active.date)}: ${clickLabel(active.count)}.`
							: `Clicks over time. ${visibleData.length} points, peak ${max}. Focus the chart and use the arrow keys to read each value.`
					}
					tabIndex={0}
					onKeyDown={(event) => {
						if (event.key === "ArrowRight") {
							event.preventDefault();
							step(1);
						} else if (event.key === "ArrowLeft") {
							event.preventDefault();
							step(-1);
						} else if (event.key === "Home") {
							event.preventDefault();
							setHovered(0);
						} else if (event.key === "End") {
							event.preventDefault();
							setHovered(markers.length - 1);
						} else if (event.key === "Escape") {
							setHovered(null);
						}
					}}
					onBlur={() => setHovered(null)}
					onPointerLeave={() => setHovered(null)}
					className={cn(
						"rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						verbose ? "h-64 min-w-[620px] w-full" : "h-44 w-full",
					)}
				>
					<defs>
						<linearGradient id="clicksFill" x1="0" x2="0" y1="0" y2="1">
							<stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
							<stop offset="100%" stopColor="currentColor" stopOpacity="0" />
						</linearGradient>
					</defs>
					{ticks.map((tick) => {
						const y = baseline - (tick / max) * plotHeight;
						return (
							<g key={tick}>
								<line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
								{verbose ? <text x={pad.left - 10} y={y + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{tick}</text> : null}
							</g>
						);
					})}
					{points.map((point) => (
						<rect key={`bar-${point.key}`} x={point.x - barWidth / 2} y={point.y} width={barWidth} height={Math.max(1, baseline - point.y)} rx="2" fill="currentColor" opacity="0.18" />
					))}
					{averageY ? (
						<g>
							<line x1={pad.left} x2={width - pad.right} y1={averageY} y2={averageY} stroke="currentColor" strokeDasharray="5 5" strokeOpacity="0.45" strokeWidth="1.5" />
							{textLabel("avg", width - pad.right - 4, averageY - 6)}
						</g>
					) : null}
					<path d={area} fill="url(#clicksFill)" />
					<path d={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
					{data.length > 1
						? points.map((point) => <circle key={point.key} cx={point.x} cy={point.y} r="3" fill="currentColor" />)
						: <circle cx={pad.left + plotWidth / 2} cy={points[0].y} r="4.5" fill="currentColor" />}
					{verbose ? labelIndexes.map((index) => {
						const point = points[index];
						return <text key={`label-${point.key}`} x={point.x} y={height - 8} textAnchor={index === 0 ? "start" : index === visibleData.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[11px]">{formatStatsPoint(point.date)}</text>;
					}) : null}
					{active ? (
						<g pointerEvents="none">
							<line x1={active.x} x2={active.x} y1={pad.top} y2={baseline} stroke="currentColor" strokeOpacity="0.35" strokeDasharray="4 4" strokeWidth="1" />
							<circle cx={active.x} cy={active.y} r="7" fill="currentColor" fillOpacity="0.2" />
							<circle cx={active.x} cy={active.y} r="4" fill="currentColor" />
						</g>
					) : null}
					{/* Transparent and last-but-one so the zones sit above the marks and collect the
					    pointer, while the tooltip below stays on top of everything. */}
					{zones.map((zone, index) => (
						<rect
							key={`zone-${markers[index].key}`}
							x={zone.left}
							y={pad.top}
							width={zone.width}
							height={Math.max(1, baseline - pad.top)}
							fill="transparent"
							onPointerEnter={() => setHovered(index)}
							onPointerDown={() => setHovered(index)}
						/>
					))}
					{active ? (
					<ChartTooltip x={active.x} y={active.y} heading={formatStatsPoint(active.date)} value={clickLabel(active.count)} chartWidth={width} />
					) : null}
				</svg>
				<span className="pointer-events-none absolute right-3 top-2 text-xs font-medium text-muted-foreground">peak {max}</span>
			</div>
			{verbose ? (
				<div className="grid gap-2 rounded-md bg-secondary/60 p-3 text-xs text-secondary-foreground sm:grid-cols-[auto_1fr] sm:items-center">
					<span className="font-semibold">{cumulative ? "Cumulative view" : "Recent values"}</span>
					<div className="flex flex-wrap gap-1.5">
						{recent.map((point) => (
							<span key={point.date} className="rounded bg-background px-2 py-1 tabular-nums text-foreground">
								{formatStatsPoint(point.date)}: {point.count}
							</span>
						))}
					</div>
				</div>
			) : (
				<div className="flex justify-between text-xs text-muted-foreground">
					<span>{data[0]?.date}</span>
					<span>{data[data.length - 1]?.date}</span>
				</div>
			)}
		</div>
	);
}

function textLabel(label: string, x: number, y: number) {
	return <text x={x} y={y} textAnchor="end" className="fill-muted-foreground text-[11px]">{label}</text>;
}

const DONUT_PALETTE = ["#0C315C", "#90B4CC", "#3D5266", "#717D89", "#AAAFB5", "#343B41"];

export function DonutChart({ data, label }: { data: Bucket[]; label: string }) {
	const [hovered, setHovered] = useState<string | null>(null);
	const total = data.reduce((sum, row) => sum + row.count, 0);
	if (!total) return <ChartEmpty>{`No ${label.toLowerCase()} data yet.`}</ChartEmpty>;
	// Keep it readable: show the top 5 slices and roll the rest into "Other".
	const sorted = [...data].sort((a, b) => b.count - a.count);
	const shown = sorted.length > 6 ? sorted.slice(0, 5) : sorted;
	const rest = sorted.slice(shown.length).reduce((sum, row) => sum + row.count, 0);
	const slices = rest > 0 ? [...shown, { bucket: "Other", count: rest }] : shown;
	const radius = 42;
	const circumference = 2 * Math.PI * radius;
	const segments = slices.map((row, index) => {
		const fraction = row.count / total;
		const preceding = slices.slice(0, index).reduce((sum, earlier) => sum + earlier.count, 0) / total;
		return { ...row, color: DONUT_PALETTE[index % DONUT_PALETTE.length], dash: fraction * circumference, offset: preceding * circumference, pct: Math.round(fraction * 100) };
	});
	const active = segments.find((segment) => segment.bucket === hovered) ?? null;
	return (
		<div className="flex items-center gap-4" aria-label={label} onPointerLeave={() => setHovered(null)}>
			<div className="relative shrink-0">
				<svg viewBox="0 0 100 100" className="size-28 -rotate-90" role="img" aria-label={label}>
					<circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="16" className="text-muted-foreground" />
					{segments.map((segment) => (
						<circle
							key={segment.bucket}
							cx="50"
							cy="50"
							r={radius}
							fill="none"
							stroke={segment.color}
							// Grow the hovered ring slightly and fade the rest, so the slice and its
							// legend row read as one thing without moving any layout.
							strokeWidth={active?.bucket === segment.bucket ? 20 : 16}
							strokeOpacity={!active || active.bucket === segment.bucket ? 1 : 0.35}
							strokeDasharray={`${segment.dash.toFixed(2)} ${(circumference - segment.dash).toFixed(2)}`}
							strokeDashoffset={-segment.offset}
							onPointerEnter={() => setHovered(segment.bucket)}
							onPointerDown={() => setHovered(segment.bucket)}
						/>
					))}
				</svg>
				<div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
					<div>
						<p className="font-heading text-lg leading-none tabular-nums">{active ? active.count : total}</p>
						<p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{active ? `${active.pct}%` : "total"}</p>
					</div>
				</div>
			</div>
			<ul className="grid min-w-0 flex-1 gap-1 text-sm">
				{segments.map((segment) => (
					<li
						key={segment.bucket}
						className={cn(
							"flex items-center gap-2 rounded px-1 transition-colors",
							active?.bucket === segment.bucket ? "bg-secondary/70" : active ? "opacity-55" : undefined,
						)}
						onPointerEnter={() => setHovered(segment.bucket)}
					>
						<span className="size-2.5 shrink-0 rounded-full" style={{ background: segment.color }} />
						<span className="truncate text-muted-foreground">{segment.bucket}</span>
						<span className="ml-auto whitespace-nowrap font-medium tabular-nums">{segment.count} · {segment.pct}%</span>
					</li>
				))}
			</ul>
		</div>
	);
}

export function BucketBars({ data, label }: { data: Bucket[]; label: string }) {
	if (!data.length) return <ChartEmpty>{`No ${label.toLowerCase()} data yet.`}</ChartEmpty>;
	const max = maxCount(data);
	const total = data.reduce((sum, row) => sum + row.count, 0);
	return (
		<div className="grid gap-2" aria-label={label}>
			{data.map((row) => (
				<div
					key={row.bucket}
					className="group grid grid-cols-[minmax(7rem,1fr)_3fr_auto] items-center gap-3 rounded px-1 text-sm transition-colors hover:bg-secondary/60"
					// Share of total is the number people actually want off a bar chart, and it is
					// only worth the row width on hover.
					title={`${row.bucket}: ${clickLabel(row.count)}${total > 0 ? ` (${Math.round((row.count / total) * 100)}% of ${total})` : ""}`}
				>
					<span className="truncate text-muted-foreground">{row.bucket}</span>
					<span className="h-2 rounded-full bg-muted">
						<span
							className="block h-full rounded-full bg-primary transition-[filter] group-hover:brightness-110"
							style={{ width: `${Math.max(6, (row.count / max) * 100)}%` }}
						/>
					</span>
					<span className="font-medium tabular-nums">{row.count}</span>
				</div>
			))}
		</div>
	);
}

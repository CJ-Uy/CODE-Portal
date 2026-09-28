/**
 * Pure geometry for the click charts. Kept out of charts.tsx because that file is a React
 * component module, and the Workers test pool cannot resolve React.
 */

export type HitZone = { left: number; width: number };

/**
 * Tiles the plot edge to edge, giving each marker the span reaching halfway to its
 * neighbours. Every pixel belongs to exactly one marker, so there is no dead gap where a
 * hover would silently do nothing.
 */
export function hitZones(markerXs: number[], plotLeft: number, plotRight: number): HitZone[] {
	return markerXs.map((x, index) => {
		const left = index === 0 ? plotLeft : (markerXs[index - 1] + x) / 2;
		const right = index === markerXs.length - 1 ? plotRight : (x + markerXs[index + 1]) / 2;
		return { left, width: Math.max(1, right - left) };
	});
}

/**
 * Arrow-key movement across the markers. Clamps at both ends rather than wrapping, so
 * holding an arrow key parks at the first or last value instead of cycling. Entering from
 * no selection starts at whichever end the key is travelling from.
 */
export function stepIndex(current: number | null, delta: number, length: number): number {
	if (length <= 0) return 0;
	const from = current ?? (delta > 0 ? -1 : length);
	return Math.min(Math.max(from + delta, 0), length - 1);
}

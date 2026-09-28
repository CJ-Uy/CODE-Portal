// Deterministic, seedable sampling without a dependency. A small string hash
// seeds a mulberry32 PRNG, which drives a partial Fisher-Yates shuffle. Given
// the same input order, size, and seed, the output is always identical.
function hashSeed(seed: string): number {
	let h = 1779033703 ^ seed.length;
	for (let i = 0; i < seed.length; i += 1) {
		h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	return h >>> 0;
}

function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function seededSample<T>(items: T[], size: number, seed: string): T[] {
	const count = Math.max(0, Math.min(size, items.length));
	if (count === 0) return [];

	const pool = [...items];
	const random = mulberry32(hashSeed(seed));
	for (let i = 0; i < count; i += 1) {
		const j = i + Math.floor(random() * (pool.length - i));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	return pool.slice(0, count);
}

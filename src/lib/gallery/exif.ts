/**
 * The moment a JPEG was taken, from its EXIF DateTimeOriginal (falling back to DateTime). Phones pick
 * photos with lastModified set to the moment of picking, so without this every photo would sort by
 * upload time. Reads only the first APP1 segment; returns null for anything it does not recognise.
 *
 * EXIF stores local wall-clock time with no zone. CODE's members are in Manila, so it is read as +08:00.
 */
export function readExifDate(bytes: Uint8Array): Date | null {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let offset = 2;
	while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
		const marker = bytes[offset + 1];
		const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
		if (marker === 0xe1 && ascii(bytes, offset + 4, 6) === "Exif\0\0") return readTiff(bytes, offset + 10);
		if (marker === 0xda) return null; // image data starts; no EXIF before it
		offset += 2 + length;
	}
	return null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(start, start + length));
}

function readTiff(bytes: Uint8Array, tiff: number): Date | null {
	const little = ascii(bytes, tiff, 2) === "II";
	const u16 = (at: number) => (little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1]);
	const u32 = (at: number) => (little ? (u16(at) | (u16(at + 2) << 16)) >>> 0 : ((u16(at) << 16) | u16(at + 2)) >>> 0);
	const entries = (ifd: number) => {
		const out = new Map<number, number>();
		const count = u16(ifd);
		for (let index = 0; index < count; index++) {
			const entry = ifd + 2 + index * 12;
			if (entry + 12 > bytes.length) break;
			out.set(u16(entry), u32(entry + 8));
		}
		return out;
	};
	const ifd0 = tiff + u32(tiff + 4);
	if (ifd0 + 2 > bytes.length) return null;
	const root = entries(ifd0);
	const exifPointer = root.get(0x8769);
	const exif = exifPointer !== undefined && tiff + exifPointer + 2 <= bytes.length ? entries(tiff + exifPointer) : new Map<number, number>();
	// Both are 20-byte ASCII values, "YYYY:MM:DD HH:MM:SS\0", stored at an offset from the TIFF header.
	const valueOffset = exif.get(0x9003) ?? root.get(0x0132);
	if (valueOffset === undefined || tiff + valueOffset + 19 > bytes.length) return null;
	const match = ascii(bytes, tiff + valueOffset, 19).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
	if (!match || match[1] === "0000") return null;
	const date = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`);
	return Number.isNaN(date.getTime()) ? null : date;
}

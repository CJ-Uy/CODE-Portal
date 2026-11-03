import { describe, expect, it } from "vitest";
import { readExifDate } from "./exif";
import { countLabel, daysLeftLabel, formatDuration, fromManilaInput, galleryFileUrl, galleryThumbUrl, groupByDay, groupByDaysLeft, toManilaInput } from "./view";

describe("gallery view helpers", () => {
	it("groups by Manila calendar day, keeps order, and falls back to upload time", () => {
		const now = new Date("2026-10-23T00:00:00Z");
		const items = [
			{ id: "a", takenAt: new Date("2026-10-18T15:30:00Z") }, // Oct 18, 23:30 in Manila
			{ id: "b", takenAt: new Date("2026-10-18T02:00:00Z") },
			{ id: "c", takenAt: null, createdAt: new Date("2026-10-18T16:30:00Z") }, // Oct 19, 00:30 in Manila
			{ id: "d", takenAt: new Date("2025-12-31T04:00:00Z") },
		];
		const groups = groupByDay(items, now);
		expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
			["Sunday, October 18", ["a", "b"]],
			["Monday, October 19", ["c"]],
			["Wednesday, December 31, 2025", ["d"]],
		]);
	});

	it("counts Recently deleted down, soonest first", () => {
		const groups = groupByDaysLeft([{ id: "x", daysLeft: 12 }, { id: "y", daysLeft: 1 }, { id: "z", daysLeft: 12 }]);
		expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
			["1 day left", ["y"]],
			["12 days left", ["x", "z"]],
		]);
		expect(daysLeftLabel(0)).toBe("Deleting today");
	});

	it("builds proxy URLs for previews, posters and downloads", () => {
		expect(galleryFileUrl("gallery/g/m/original.jpg", { width: 480 })).toBe("/api/uploads/gallery%2Fg%2Fm%2Foriginal.jpg?w=480");
		expect(galleryFileUrl("gallery/g/m/original.mp4", { download: "Clip one" })).toBe("/api/uploads/gallery%2Fg%2Fm%2Foriginal.mp4?download=1&name=Clip+one");
		expect(galleryThumbUrl({ kind: "video", fileKey: "v", posterKey: null })).toBeNull();
		expect(galleryThumbUrl({ kind: "video", fileKey: "v", posterKey: "p.jpg" })).toBe("/api/uploads/p.jpg");
	});

	it("round-trips the date-taken field in Manila time", () => {
		const date = new Date("2026-10-18T06:30:00Z");
		expect(toManilaInput(date)).toBe("2026-10-18T14:30");
		expect(new Date(fromManilaInput("2026-10-18T14:30")!).getTime()).toBe(date.getTime());
		expect(toManilaInput(null)).toBe("");
		expect(fromManilaInput("")).toBeNull();
	});

	it("formats durations and counts", () => {
		expect(formatDuration(42.4)).toBe("0:42");
		expect(formatDuration(725)).toBe("12:05");
		expect(formatDuration(3729)).toBe("1:02:09");
		expect(countLabel([{ kind: "photo" }, { kind: "video" }, { kind: "photo" }])).toBe("2 photos and 1 video");
		expect(countLabel([{ kind: "photo" }])).toBe("1 photo");
	});
});

/** A minimal big-endian JPEG whose EXIF IFD holds DateTimeOriginal. */
function jpegWithExifDate(value: string): Uint8Array {
	const text = [...value, "\0"].map((char) => char.charCodeAt(0));
	const tiff = [
		0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8,
		// IFD0: one entry pointing at the EXIF IFD (offset 26)
		0, 1, 0x87, 0x69, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0,
		// EXIF IFD: DateTimeOriginal, ASCII x20 at offset 44
		0, 1, 0x90, 0x03, 0, 2, 0, 0, 0, 20, 0, 0, 0, 44, 0, 0, 0, 0,
		...text,
	];
	const app1 = [0xff, 0xe1, 0, 2 + 6 + tiff.length, ...[..."Exif\0\0"].map((char) => char.charCodeAt(0)), ...tiff];
	return new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xda, 0, 2]);
}

describe("readExifDate", () => {
	it("reads DateTimeOriginal as Manila time", () => {
		expect(readExifDate(jpegWithExifDate("2026:10:18 14:30:05"))?.toISOString()).toBe("2026-10-18T06:30:05.000Z");
	});

	it("returns null for non-JPEGs, missing EXIF and zeroed dates", () => {
		expect(readExifDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
		expect(readExifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
		expect(readExifDate(jpegWithExifDate("0000:00:00 00:00:00"))).toBeNull();
	});
});

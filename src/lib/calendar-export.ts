export type CalendarExportEvent = {
	title: string;
	place: string;
	description: string;
	startsAt: Date;
	endsAt: Date | null;
	allDay: boolean;
	endDate: string;
	startDate: string;
	uid: string;
};

const CRLF = "\r\n";

function addDays(date: string, days: number): string {
	const [year, month, day] = date.split("-").map(Number);
	const result = new Date(Date.UTC(year, month - 1, day + days));
	return [result.getUTCFullYear(), result.getUTCMonth() + 1, result.getUTCDate()]
		.map((part) => String(part).padStart(2, "0"))
		.join("-");
}

function basicDate(date: string): string {
	return date.replaceAll("-", "");
}

function utcDateTime(date: Date): string {
	return date.toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function datesFor(event: CalendarExportEvent): string {
	if (event.allDay) {
		return `${basicDate(event.startDate)}/${basicDate(addDays(event.endDate, 1))}`;
	}

	const end = event.endsAt ?? new Date(event.startsAt.getTime() + 60 * 60 * 1000);
	return `${utcDateTime(event.startsAt)}/${utcDateTime(end)}`;
}

function escapeText(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll(";", "\\;")
		.replaceAll(",", "\\,")
		.replace(/\r\n|\r|\n/g, "\\n");
}

function foldLine(line: string): string {
	const encoder = new TextEncoder();
	const parts: string[] = [];
	let part = "";
	let bytes = 0;
	let limit = 75;

	for (const character of line) {
		const characterBytes = encoder.encode(character).length;
		if (bytes + characterBytes > limit) {
			parts.push(part);
			part = character;
			bytes = characterBytes;
			limit = 74;
		} else {
			part += character;
			bytes += characterBytes;
		}
	}

	parts.push(part);
	return parts.join(`${CRLF} `);
}

export function googleCalendarUrl(event: CalendarExportEvent, shareUrl: string): string {
	const params = [
		["action", "TEMPLATE"],
		["text", event.title],
		["dates", datesFor(event)],
		["details", `${event.description}\n\n${shareUrl}`],
		["location", event.place],
	];
	const query = params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
	return `https://calendar.google.com/calendar/render?${query}`;
}

export function icsFor(event: CalendarExportEvent, shareUrl: string): string {
	const end = event.endsAt ?? new Date(event.startsAt.getTime() + 60 * 60 * 1000);
	const dates = event.allDay
		? [
				`DTSTART;VALUE=DATE:${basicDate(event.startDate)}`,
				`DTEND;VALUE=DATE:${basicDate(addDays(event.endDate, 1))}`,
			]
		: [`DTSTART:${utcDateTime(event.startsAt)}`, `DTEND:${utcDateTime(end)}`];
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//CODE//Club Event Calendar Export//EN",
		"BEGIN:VEVENT",
		`UID:${event.uid}`,
		`DTSTAMP:${utcDateTime(new Date())}`,
		...dates,
		`SUMMARY:${escapeText(event.title)}`,
		`LOCATION:${escapeText(event.place)}`,
		`DESCRIPTION:${escapeText(`${event.description}\n\n${shareUrl}`)}`,
		`URL:${shareUrl}`,
		"END:VEVENT",
		"END:VCALENDAR",
	];

	return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}

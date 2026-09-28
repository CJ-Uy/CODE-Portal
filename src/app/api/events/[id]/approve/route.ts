import { NextResponse } from "next/server";

export async function POST() {
	return NextResponse.json({ error: "Event review flow retired." }, { status: 410 });
}

import { NextResponse } from "next/server";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";

export async function GET() {
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

	try {
		const repositories = await getRepositories();
		const members = await repositories.members.list(actor, { limit: 25 });
		return NextResponse.json({ members });
	} catch {
		return NextResponse.json({ error: "Not authorized." }, { status: 403 });
	}
}

export async function POST() {
	return NextResponse.json({ error: "Member accounts are created on first sign-in." }, { status: 405 });
}

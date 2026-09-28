import { NextResponse } from "next/server";
import { getDatabaseAdapter } from "@/db";
import { hasCloudflareBinding } from "@/server/cloudflare";
import { getPublicEnvStatus } from "@/server/env";
import { getStorageAdapter } from "@/storage";

export async function GET() {
	const database = getDatabaseAdapter();
	const storage = await getStorageAdapter();

	return NextResponse.json({
		...getPublicEnvStatus(),
		adapters: {
			database: database.adapterType,
			storage: storage.adapterType,
		},
		cloudflareBindings: {
			DB: hasCloudflareBinding("DB"),
			BUCKET: hasCloudflareBinding("BUCKET"),
		},
	});
}


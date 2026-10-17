import { headers } from "next/headers";
import { PORTAL_PATH_HEADER } from "./access";

// The /signin URL for this request, carrying the portal page that was asked for.
// The sign-in page validates `next` before using it.
export async function signInPath(): Promise<string> {
	const next = (await headers()).get(PORTAL_PATH_HEADER);
	return next ? `/signin?${new URLSearchParams({ next })}` : "/signin";
}

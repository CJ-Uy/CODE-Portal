import { notFound } from "next/navigation";

// Unknown short links land here (see src/server/links/redirect.ts) so they get the branded 404 page.
export default function LinkNotFound() {
	notFound();
}

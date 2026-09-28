import { createId } from "@/lib/ids";
import { can, type Actor } from "@/server/auth/permissions";
import type { StorageAdapter } from "@/storage/types";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

const allowedContentTypes = new Map([
	["image/gif", "gif"],
	["image/jpeg", "jpg"],
	["image/png", "png"],
	["image/webp", "webp"],
]);

type UploadHandlerDependencies = {
	getActor(request: Request): Promise<Actor | null>;
	storage: StorageAdapter;
	canPostEvent(actor: Actor, eventId: string): Promise<boolean>;
	canEditLink(actor: Actor, linkId: string): Promise<boolean>;
};

export function createUploadHandlers(dependencies: UploadHandlerDependencies) {
	return {
		async collection(request: Request): Promise<Response> {
			const actor = await dependencies.getActor(request);
			if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
			if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
			if (request.headers.has("x-object-key")) {
				return Response.json({ error: "Upload keys are assigned by the server." }, { status: 400 });
			}
			const contentLength = Number(request.headers.get("content-length"));
			if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
				return Response.json({ error: "Image exceeds the 5 MB limit." }, { status: 413 });
			}

			const contentType = request.headers.get("content-type") ?? "";
			if (!contentType.includes("multipart/form-data")) {
				return Response.json({ error: "Expected a multipart image upload." }, { status: 400 });
			}

			const form = await request.formData();
			if (form.has("key")) {
				return Response.json({ error: "Upload keys are assigned by the server." }, { status: 400 });
			}
			const file = form.get("file");
			if (!(file instanceof File)) {
				return Response.json({ error: "Expected multipart field named file." }, { status: 400 });
			}

			const extension = allowedContentTypes.get(file.type);
			if (!extension) {
				return Response.json({ error: "Unsupported image type." }, { status: 415 });
			}
			if (file.size > MAX_UPLOAD_BYTES) {
				return Response.json({ error: "Image exceeds the 5 MB limit." }, { status: 413 });
			}

			const purpose = form.get("purpose");
			let key: string;
			if (purpose === "avatar") {
				key = `avatars/${actor.memberId}/${createId("avatar")}.${extension}`;
			} else if (purpose === "event_media") {
				const eventId = form.get("eventId");
				if (typeof eventId !== "string" || !isSafeSegment(eventId)) {
					return Response.json({ error: "A valid event is required." }, { status: 400 });
				}
				if (!(await dependencies.canPostEvent(actor, eventId))) {
					return Response.json({ error: "Not authorized to upload media for this event." }, { status: 403 });
				}
				key = `events/${eventId}/${actor.memberId}/${createId("media")}.${extension}`;
			} else if (purpose === "link_preview") {
				const linkId = form.get("linkId");
				if (typeof linkId !== "string" || !isSafeSegment(linkId)) {
					return Response.json({ error: "A valid link is required." }, { status: 400 });
				}
				if (!(await dependencies.canEditLink(actor, linkId))) {
					return Response.json({ error: "Not authorized to upload a preview for this link." }, { status: 403 });
				}
				key = `links/${linkId}/${actor.memberId}/${createId("preview")}.${extension}`;
			} else {
				return Response.json({ error: "Unknown upload purpose." }, { status: 400 });
			}

			const result = await dependencies.storage.putObject({ key, body: file, contentType: file.type });
			return Response.json(result, { status: 201 });
		},

		async object(request: Request, key: string): Promise<Response> {
			const namespace = parseNamespace(key);
			if (!namespace) return Response.json({ error: "Object not found." }, { status: 404 });

			if (request.method === "GET") {
				if (!namespace.public) {
					const actor = await dependencies.getActor(request);
					if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
				}
				const object = await dependencies.storage.getObject(key);
				if (!object.body) return Response.json({ error: "Object not found." }, { status: 404 });
				return new Response(object.body, {
					headers: { "Content-Type": object.contentType ?? "application/octet-stream" },
				});
			}

			const actor = await dependencies.getActor(request);
			if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });

			if (request.method === "DELETE") {
				const authorized = namespace.linkId
					? can(actor, "link:moderate") || await dependencies.canEditLink(actor, namespace.linkId)
					: namespace.ownerMemberId === actor.memberId || can(actor, "member:manage");
				if (!authorized) {
					return Response.json({ error: "Not authorized to delete this object." }, { status: 403 });
				}
				await dependencies.storage.deleteObject(key);
				return new Response(null, { status: 204 });
			}

			return new Response("Method not allowed", { status: 405 });
		},
	};
}

function parseNamespace(key: string): { ownerMemberId: string; public: boolean; linkId?: string } | null {
	if (key.includes("..") || key.startsWith("/")) return null;
	const parts = key.split("/");
	if (parts[0] === "avatars" && parts.length === 3 && parts.every(isSafeSegment)) {
		return { ownerMemberId: parts[1], public: false };
	}
	if (parts[0] === "events" && parts.length === 4 && parts.every(isSafeSegment)) {
		return { ownerMemberId: parts[2], public: false };
	}
	if (parts[0] === "links" && parts.length === 4 && parts.every(isSafeSegment)) {
		return { ownerMemberId: parts[2], public: true, linkId: parts[1] };
	}
	return null;
}

function isSafeSegment(value: string): boolean {
	return /^[A-Za-z0-9._-]+$/.test(value) && value !== "." && value !== "..";
}

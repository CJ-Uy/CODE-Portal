import { z } from "zod";
import { eventAwardsInputSchema } from "@/db/types";
import { eventTypeKeySchema } from "@/lib/event-type-key";
import { eventSignupAnswersSchema, eventSignupFormInputSchema } from "@/lib/event-signup-form";
import { operation } from "./common";

export const eventOutputSchema = z.object({
	id: z.string(),
	title: z.string(),
	type: eventTypeKeySchema,
	status: z.enum(["pending", "approved", "rejected"]),
	points: z.number().int().nullable(),
	place: z.string(),
	capacity: z.number().int().nullable(),
	startsAt: z.coerce.date(),
	endsAt: z.coerce.date().nullable(),
	description: z.string(),
	rsvpFormJson: eventSignupFormInputSchema,
	rsvpResponsesPublic: z.boolean(),
	createdBy: z.string(),
	approvedBy: z.string().nullable(),
	approvedAt: z.coerce.date().nullable(),
	createdAt: z.coerce.date(),
	myRole: z.enum(["owner", "admin", "scanner"]).nullable(),
	canModerate: z.boolean(),
	canSetPoints: z.boolean(),
	deletedAt: z.coerce.date().nullable(),
});

export const attendanceOutputSchema = z.object({
	memberId: z.string(),
	fullName: z.string().nullable(),
	name: z.string().nullable(),
	scannedAt: z.coerce.date(),
	scannedBy: z.string(),
});

export const eventStaffOutputSchema = z.object({
	memberId: z.string(),
	fullName: z.string().nullable(),
	name: z.string().nullable(),
	role: z.enum(["owner", "admin", "scanner"]),
});

const forumAuthorOutputSchema = z.object({
	memberId: z.string(),
	fullName: z.string().nullable(),
	name: z.string().nullable(),
});

export const forumPostOutputSchema = z.object({
	id: z.string(),
	eventId: z.string(),
	parentId: z.string().nullable(),
	body: z.string(),
	anonymous: z.boolean(),
	createdAt: z.coerce.date(),
	author: forumAuthorOutputSchema.nullable(),
});

export const mediaOutputSchema = z.object({
	id: z.string(),
	eventId: z.string(),
	r2Key: z.string(),
	caption: z.string().nullable(),
	uploadedBy: z.string(),
	createdAt: z.coerce.date(),
});

export const createEventInputSchema = z.object({
	title: z.string().trim().min(1).max(160),
	type: eventTypeKeySchema,
	place: z.string().trim().min(1).max(160),
	description: z.string().trim().min(1).max(4000),
	startsAt: z.coerce.date(),
	endsAt: z.coerce.date(),
	capacity: z.number().int().min(1).max(100000).nullable().default(null),
	rsvpForm: eventSignupFormInputSchema.default([]),
	rsvpResponsesPublic: z.boolean().default(false),
});

export const updateEventInputSchema = createEventInputSchema.partial().extend({
	eventId: z.string().min(1),
});

const staffRoleInputSchema = z.enum(["admin", "scanner"]);

export const postForumInputSchema = z.object({
	eventId: z.string().min(1),
	body: z.string().trim().min(1).max(4000),
	anonymous: z.boolean().default(false),
	parentId: z.string().min(1).nullable().default(null),
});

export const addMediaInputSchema = z.object({
	eventId: z.string().min(1),
	r2Key: z.string().min(1).max(512),
	caption: z.string().trim().max(280).nullable().default(null),
});

export const eventsContract = {
	listPublished: operation({
		input: z.object({
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
		output: z.object({ events: z.array(eventOutputSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
	create: operation({
		input: createEventInputSchema,
		output: z.object({ event: eventOutputSchema }),
		auth: "member",
		sharedDev: "deny",
	}),
	update: operation({
		input: updateEventInputSchema,
		output: z.object({ event: eventOutputSchema }),
		auth: "member",
		sharedDev: "deny",
	}),
	delete: operation({
		input: z.object({ eventId: z.string().min(1) }),
		output: z.object({ ok: z.boolean() }),
		auth: "member",
		sharedDev: "deny",
	}),
	setAwards: operation({
		input: z.object({
			eventId: z.string().min(1),
			awards: eventAwardsInputSchema,
		}),
		output: z.object({ updated: z.number().int().min(0) }),
		auth: "admin",
		permission: "event:points",
		sharedDev: "deny",
	}),
	addStaff: operation({
		input: z.object({ eventId: z.string().min(1), memberId: z.string().min(1), role: staffRoleInputSchema }),
		output: z.object({ ok: z.boolean() }),
		auth: "member",
		sharedDev: "deny",
	}),
	removeStaff: operation({
		input: z.object({ eventId: z.string().min(1), memberId: z.string().min(1) }),
		output: z.object({ ok: z.boolean() }),
		auth: "member",
		sharedDev: "deny",
	}),
	transferOwnership: operation({
		input: z.object({ eventId: z.string().min(1), toMemberId: z.string().min(1) }),
		output: z.object({ ok: z.boolean() }),
		auth: "member",
		sharedDev: "deny",
	}),
	invite: operation({
		input: z.object({ eventId: z.string().min(1), memberIds: z.array(z.string().min(1)).min(1) }),
		output: z.object({ invited: z.number().int().min(0) }),
		auth: "member",
		sharedDev: "deny",
	}),
	listInvites: operation({
		input: z.object({ eventId: z.string().min(1) }),
		output: z.object({
			invites: z.array(
				z.object({
					memberId: z.string(),
					fullName: z.string().nullable(),
					name: z.string().nullable(),
					invitedAt: z.coerce.date(),
				}),
			),
		}),
		auth: "member",
		sharedDev: "allow",
	}),
	listStaff: operation({
		input: z.object({ eventId: z.string().min(1) }),
		output: z.object({ staff: z.array(eventStaffOutputSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
	rsvp: operation({
		input: z.object({ eventId: z.string().min(1), state: z.enum(["going", "none"]), answers: eventSignupAnswersSchema.optional() }),
		output: z.object({ state: z.enum(["going", "none"]) }),
		auth: "member",
		sharedDev: "allow",
	}),
	scan: operation({
		input: z.object({ eventId: z.string().min(1), memberId: z.string().min(1), termId: z.string().min(1) }),
		output: z.object({
			eventId: z.string(),
			memberId: z.string(),
			memberName: z.string().nullable(),
			memberImage: z.string().nullable(),
			scannedAt: z.coerce.date(),
			scannedByName: z.string().nullable(),
			alreadyPresent: z.boolean(),
		}),
		auth: "member",
		sharedDev: "deny",
	}),
	undoScan: operation({
		input: z.object({ eventId: z.string().min(1), memberId: z.string().min(1) }),
		output: z.object({ removed: z.boolean() }),
		auth: "member",
		sharedDev: "deny",
	}),
	searchMembers: operation({
		input: z.object({
			eventId: z.string().min(1),
			query: z.string().trim().min(1).max(120),
			limit: z.number().int().min(1).max(50).default(20),
		}),
		output: z.object({
			members: z.array(
				z.object({
					memberId: z.string(),
					fullName: z.string().nullable(),
					name: z.string().nullable(),
					email: z.string(),
					alreadyScanned: z.boolean(),
				}),
			),
		}),
		auth: "member",
		sharedDev: "allow",
	}),
	listAttendance: operation({
		input: z.object({ eventId: z.string().min(1) }),
		output: z.object({ attendance: z.array(attendanceOutputSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
	post: operation({
		input: postForumInputSchema,
		output: z.object({ post: forumPostOutputSchema }),
		auth: "member",
		sharedDev: "allow",
	}),
	listForumPosts: operation({
		input: z.object({
			eventId: z.string().min(1),
			limit: z.number().int().min(1).max(100).default(100),
			offset: z.number().int().min(0).default(0),
		}),
		output: z.object({ posts: z.array(forumPostOutputSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
	revealAuthor: operation({
		input: z.object({ postId: z.string().min(1) }),
		output: z.object({ author: forumAuthorOutputSchema }),
		auth: "admin",
		permission: "member:manage",
		sharedDev: "deny",
	}),
	addMedia: operation({
		input: addMediaInputSchema,
		output: z.object({ media: mediaOutputSchema }),
		auth: "admin",
		permission: "event:moderate",
		sharedDev: "deny",
	}),
	listMedia: operation({
		input: z.object({ eventId: z.string().min(1) }),
		output: z.object({ media: z.array(mediaOutputSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
};

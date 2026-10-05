export type EmailBlock =
	| { id: string; type: "heading"; props: { text: string; level: 1 | 2 } }
	| { id: string; type: "text"; props: { text: string } }
	| { id: string; type: "button"; props: { label: string; href: string } }
	| { id: string; type: "image"; props: { src: string; alt: string; href?: string } }
	| { id: string; type: "divider"; props: Record<string, never> }
	| { id: string; type: "spacer"; props: { size: "sm" | "md" | "lg" } }
	| {
			id: string;
			type: "event";
			/** title/when/place/path are a snapshot taken when the block is picked and again when the email is scheduled. */
			props: { eventId: string; title: string; when: string; place: string; path: string };
	  };

export type EmailBlockType = EmailBlock["type"];

export type AudienceRule =
	| { kind: "roster"; termId: "current" | string }
	| { kind: "role"; roleKey: string }
	| { kind: "batch"; batch: string }
	| { kind: "status"; status: "active" | "pending" | "inactive" }
	| { kind: "event"; eventId: string; relation: "rsvp" | "attended" | "no_show" }
	| { kind: "member"; memberId: string }
	| { kind: "emails"; emails: string[] };

export type Audience = {
	match: "all" | "any";
	include: AudienceRule[];
	exclude: AudienceRule[];
};

export const EMPTY_AUDIENCE: Audience = { match: "any", include: [], exclude: [] };

export type EmailCampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled" | "failed";
export type EmailDeliveryStatus = "pending" | "sent" | "failed" | "skipped_optout" | "cancelled";

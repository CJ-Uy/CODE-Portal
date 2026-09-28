export type AuditPhraseInput = {
	action: string;
	actorName: string | null;
	actorContext: "session" | "shared_dev_token";
	sharedTokenLabel: string | null;
	targetLabel: string | null;
	targetMemberName: string | null;
	detail: string | null;
};

type PhraseBuilder = (input: AuditPhraseInput) => string;

function withTarget(phrase: string, target: string | null): string {
	return target ? `${phrase} ${target}` : phrase;
}

function memberAt(phrase: string, input: AuditPhraseInput): string {
	return withTarget(withTarget(phrase, input.targetMemberName), input.targetLabel ? `at ${input.targetLabel}` : null);
}

const PHRASES: Record<string, PhraseBuilder> = {
	"announcement:create": ({ targetLabel }) => withTarget("created announcement", targetLabel),
	"announcement:delete": ({ targetLabel }) => withTarget("deleted announcement", targetLabel),
	"announcement:update": ({ targetLabel }) => withTarget("updated announcement", targetLabel),
	"event:add_media": ({ targetLabel }) => withTarget("added media to", targetLabel),
	"event:add_staff": ({ targetLabel }) => withTarget("added staff to", targetLabel),
	"event:create": ({ targetLabel }) => withTarget("created event", targetLabel),
	"event:delete": ({ targetLabel }) => withTarget("deleted event", targetLabel),
	"event:invite": ({ targetLabel }) => withTarget("invited members to", targetLabel),
	"event:remove_retired_award": ({ targetLabel }) => withTarget("removed retired points from", targetLabel),
	"event:remove_staff": ({ targetLabel }) => withTarget("removed staff from", targetLabel),
	"event:scan_attendance": (input) => memberAt("checked in", input),
	"event:set_awards": ({ targetLabel }) => withTarget("set points on", targetLabel),
	"event:transfer": ({ targetLabel }) => withTarget("transferred", targetLabel),
	"event:undo_scan": (input) => memberAt("undid check-in for", input),
	"event:update": ({ targetLabel }) => withTarget("updated event", targetLabel),
	"forum:reveal_author": ({ targetLabel }) => withTarget("revealed forum author for", targetLabel),
	"library:access_request": ({ targetLabel }) => withTarget("requested access to", targetLabel),
	"library:create": ({ targetLabel }) => withTarget("created library item", targetLabel),
	"library:delete": ({ targetLabel }) => withTarget("deleted library item", targetLabel),
	"library:update": ({ targetLabel }) => withTarget("updated library item", targetLabel),
	"link:create": ({ targetLabel }) => withTarget("created link", targetLabel),
	"member:create": ({ targetMemberName, targetLabel }) => withTarget("created member", targetMemberName ?? targetLabel),
	"member:delete": ({ targetMemberName, targetLabel }) => withTarget("deleted member", targetMemberName ?? targetLabel),
	"member:profile_update": ({ targetMemberName, targetLabel }) => withTarget("updated member profile", targetMemberName ?? targetLabel),
	"member:self_provision": ({ targetMemberName, targetLabel }) => withTarget("provisioned member", targetMemberName ?? targetLabel),
	"nav_pin:create": ({ targetLabel }) => withTarget("created navigation pin", targetLabel),
	"nav_pin:delete": ({ targetLabel }) => withTarget("deleted navigation pin", targetLabel),
	"nav_pin:update": ({ targetLabel }) => withTarget("updated navigation pin", targetLabel),
	"point_type:create": ({ targetLabel }) => withTarget("created point type", targetLabel),
	"point_type:update": ({ targetLabel }) => withTarget("updated point type", targetLabel),
	"quick_link:create": ({ targetLabel }) => withTarget("created quick link", targetLabel),
	"quick_link:delete": ({ targetLabel }) => withTarget("deleted quick link", targetLabel),
	"quick_link:update": ({ targetLabel }) => withTarget("updated quick link", targetLabel),
	"retention:record_manual": ({ targetMemberName, targetLabel }) =>
		withTarget("recorded manual retention for", targetMemberName ?? targetLabel),
	"role:assign": ({ targetMemberName, targetLabel }) => withTarget("assigned a role to", targetMemberName ?? targetLabel),
	"roster:add": () => "added a member to the roster",
	"roster:bulk_add": () => "bulk-added members to the roster",
	"roster:remove": () => "removed a member from the roster",
	"seed:load": () => "loaded seed data",
	"survey:create": ({ targetLabel }) => withTarget("created survey", targetLabel),
	"survey:sample": ({ targetLabel }) => withTarget("sampled members for", targetLabel),
};

export function actorDisplay(input: AuditPhraseInput): string {
	if (input.actorContext === "shared_dev_token") {
		return input.sharedTokenLabel ? `Shared token · ${input.sharedTokenLabel}` : "Shared token";
	}
	return input.actorName ?? "Deleted member";
}

export function describeAudit(input: AuditPhraseInput): string {
	const phrase = PHRASES[input.action]?.(input) ?? input.action.split(":").map((part) => part.replaceAll("_", " ")).join(" — ");
	// Falsy rather than a null check: detail is free text straight from the database, so an empty
	// string or a missing column must not render a dangling separator.
	return input.detail ? `${phrase} — ${input.detail}` : phrase;
}

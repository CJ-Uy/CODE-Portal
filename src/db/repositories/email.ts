import type { AuditRepository } from "./audit";
import type { EmailDb } from "./email-audience";
import { createEmailCampaignsRepository } from "./email-campaigns";
import { createEmailInboxRepository } from "./email-inbox";
import { createEmailMemberRepository } from "./email-member";
import { createEmailSettingsRepository } from "./email-settings";
import { createEmailTemplatesRepository } from "./email-templates";

export function createEmailRepositories(db: EmailDb, audit: AuditRepository) {
	return {
		settings: createEmailSettingsRepository(db, audit),
		templates: createEmailTemplatesRepository(db, audit),
		campaigns: createEmailCampaignsRepository(db, audit),
		inbox: createEmailInboxRepository(db, audit),
		member: createEmailMemberRepository(db),
	};
}

export type EmailRepositories = ReturnType<typeof createEmailRepositories>;

/** Shared-dev mode has no internal API for email; every call fails loudly. */
export function createUnavailableEmailRepositories(): EmailRepositories {
	const unavailable = () => {
		throw new Error("Email is unavailable through this repository adapter.");
	};
	const stub = new Proxy({}, { get: () => unavailable });
	return { settings: stub, templates: stub, campaigns: stub, inbox: stub, member: stub } as unknown as EmailRepositories;
}

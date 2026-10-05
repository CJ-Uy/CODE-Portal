import { afterEach, expect, it, vi } from "vitest";
import { getOptionalCloudflareEnv } from "@/server/cloudflare";
import { emailConfigFromEnv } from "./db";

vi.mock("@/server/cloudflare", () => ({
	getCloudflareEnv: vi.fn(),
	getOptionalCloudflareEnv: vi.fn(),
}));

afterEach(() => vi.unstubAllEnvs());

it("uses validated local email vars only when no Worker environment is available", () => {
	vi.stubEnv("EMAIL_INBOX_ADDRESS", "local@ateneocode.org");
	vi.stubEnv("EMAIL_PUBLIC_BASE_URL", "http://localhost:3101");
	vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "local-review-secret");
	vi.mocked(getOptionalCloudflareEnv).mockReturnValue(null);
	expect(emailConfigFromEnv().inboxAddress).toBe("local@ateneocode.org");
	vi.mocked(getOptionalCloudflareEnv).mockReturnValue({
		EMAIL_INBOX_ADDRESS: "worker@ateneocode.org",
		EMAIL_PUBLIC_BASE_URL: "https://beta.ateneocode.org",
		EMAIL_UNSUBSCRIBE_SECRET: "worker-review-secret",
	} as unknown as NonNullable<ReturnType<typeof getOptionalCloudflareEnv>>);
	expect(emailConfigFromEnv().inboxAddress).toBe("worker@ateneocode.org");
	vi.mocked(getOptionalCloudflareEnv).mockReturnValue({} as NonNullable<ReturnType<typeof getOptionalCloudflareEnv>>);
	expect(() => emailConfigFromEnv()).toThrow();
});

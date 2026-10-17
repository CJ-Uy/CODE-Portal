import { type Summarizer, workersAiSummarizer } from "@/lib/feedback/summary";
import { getOptionalCloudflareEnv } from "@/server/cloudflare";

// Llama 3.3 70B instruct is on Workers AI's JSON mode list: https://developers.cloudflare.com/workers-ai/features/json-mode/
export const FEEDBACK_SUMMARY_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** The Workers AI summarizer, or null when the `AI` binding is absent (local dev, tests, prod until rollout). */
export function getSummarizer(): Summarizer | null {
	const ai = getOptionalCloudflareEnv()?.AI;
	return ai ? workersAiSummarizer(ai, FEEDBACK_SUMMARY_MODEL) : null;
}

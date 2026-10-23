import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
	...nextVitals,
	...nextTs,
	globalIgnores([
		".next/**",
		".open-next/**",
		".wrangler/**",
		"out/**",
		"build/**",
		"next-env.d.ts",
		"cloudflare-env.d.ts",
		".remember/**",
		"design/**",
		"graphify-out/**",
		".local/**",
		// Agent worktrees live here and are whole checkouts of other branches.
		".claude/**",
	]),
]);

export default eslintConfig;

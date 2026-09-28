import { execFileSync } from "node:child_process";

const protectedPrefixes = [
	"src/db/schema.ts",
	"drizzle/migrations/",
	"src/db/contract/",
	"src/app/internal/",
	"src/server/auth/permissions.ts",
	"src/auth.ts",
];

const deployNotePaths = [
	"docs/operations/shared-dev-deploy-note.md",
	"docs/operations/migrations.md",
	"README.md",
	"AGENTS.md",
	"CLAUDE.md",
];

function git(args) {
	try {
		return execFileSync("git", args, { encoding: "utf8" }).trim();
	} catch (error) {
		if (process.env.CI) throw error;
		console.warn("Shared dev deploy note check skipped because git is unavailable in this local sandbox.");
		return "";
	}
}

function changedFiles() {
	const base = process.env.GITHUB_BASE_REF;
	const output = base ? git(["diff", "--name-only", `origin/${base}...HEAD`]) : git(["diff", "--name-only", "HEAD"]);
	return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

const files = changedFiles();
const protectedChanged = files.some((file) => protectedPrefixes.some((prefix) => file === prefix || file.startsWith(prefix)));
const noteChanged = files.some((file) => deployNotePaths.includes(file));

if (protectedChanged && !noteChanged) {
	console.error("Shared-dev-sensitive files changed without a shared dev deploy note.");
	console.error(`Add or update one of: ${deployNotePaths.join(", ")}`);
	process.exit(1);
}

console.log("Shared dev deploy note check passed.");

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareSnapshots } from "./schema-compare";
import { applyMigrations, openScratch, snapshot } from "./sqlite-schema";

const repo = process.cwd();
const work = mkdtempSync(path.join(tmpdir(), "trunk-"));

const trunkDb = openScratch(path.join(work, "trunk.db"));
applyMigrations(trunkDb, path.join(repo, "drizzle/migrations"));
const trunk = snapshot(trunkDb);
trunkDb.close();

// drizzle-kit writes a from-empty migration when it has no snapshot, which is exactly
// the target schema described by schema.ts.
const renderDir = path.join(work, "render");
const config = `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ schema: "./src/db/schema.ts", out: ${JSON.stringify(renderDir)}, dialect: "sqlite" });\n`;
writeFileSync(path.join(work, "render.config.ts"), config);
execFileSync("pnpm", ["exec", "drizzle-kit", "generate", "--config", path.join(work, "render.config.ts")], {
	cwd: repo,
	stdio: "pipe",
	shell: true,
});
const renderDb = openScratch(path.join(work, "render.db"));
applyMigrations(renderDb, renderDir);
const target = snapshot(renderDb);
renderDb.close();

const problems = compareSnapshots(trunk, target);
rmSync(work, { recursive: true, force: true });

console.log(`trunk tables: ${Object.keys(trunk.tables).length}, target tables: ${Object.keys(target.tables).length}`);
if (problems.length === 0) {
	console.log("CONVERGED: the trunk and schema.ts describe the same database.");
	process.exit(0);
}
console.error(`NOT CONVERGED (${problems.length})`);
for (const problem of problems) console.error("  " + problem);
process.exit(1);

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const configKeys = [
  "DAINVO_REQUIRE_CLOUD_CONFIG",
  "DAINVO_SUPABASE_URL",
  "DAINVO_SUPABASE_PUBLISHABLE_KEY",
  "DAINVO_OBSIDIAN_OAUTH_CLIENT_ID",
  "DAINVO_OBSIDIAN_OAUTH_REDIRECT_URI",
];
const cleanEnvironment = { ...process.env };
for (const key of configKeys) {
  delete cleanEnvironment[key];
}

runBuild(cleanEnvironment);
const cleanHash = hashBuild();

runBuild({
  ...cleanEnvironment,
  DAINVO_REQUIRE_CLOUD_CONFIG: "true",
  DAINVO_SUPABASE_URL: "https://conflicting.invalid",
  DAINVO_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_conflicting",
  DAINVO_OBSIDIAN_OAUTH_CLIENT_ID: "conflicting-client",
  DAINVO_OBSIDIAN_OAUTH_REDIRECT_URI: "https://conflicting.invalid/callback",
});
const conflictingHash = hashBuild();

if (cleanHash !== conflictingHash) {
  throw new Error("Production bundle changes with build-time cloud variables.");
}

function runBuild(env) {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  execFileSync(executable, ["build"], { env, stdio: "inherit" });
}

function hashBuild() {
  return createHash("sha256").update(readFileSync("main.js")).digest("hex");
}

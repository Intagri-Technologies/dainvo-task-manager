import { readFileSync } from "node:fs";

const packageJson = readJson("package.json");
const manifest = readJson("manifest.json");
const versions = readJson("versions.json");
const tag = process.argv[2]?.trim();

if (packageJson.version !== manifest.version) {
  throw new Error("package.json and manifest.json versions do not match.");
}

if (versions[manifest.version] !== manifest.minAppVersion) {
  throw new Error(
    "versions.json must map the release version to manifest.minAppVersion.",
  );
}

if (tag && tag !== manifest.version) {
  throw new Error("The release tag must match the manifest version.");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

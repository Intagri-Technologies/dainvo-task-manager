import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: ["main.js"],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          acronyms: ["HTTP", "ID", "PKCE", "URL"],
          brands: [
            "Daily Notes",
            "Dainvo",
            "IDs",
            "Markdown",
            "Obsidian",
            "Periodic Notes",
            "SecretStorage",
            "YYYY-MM-DD",
            "http://127.0.0.1:58234",
          ],
        },
      ],
    },
  },
  {
    files: ["esbuild.config.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
      },
    },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
      },
    },
  },
]);

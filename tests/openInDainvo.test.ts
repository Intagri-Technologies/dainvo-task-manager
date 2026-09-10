import { describe, expect, it } from "vitest";

import {
  appendBlockIdToTaskLine,
  buildObsidianTaskDeepLink,
  buildProjectDeepLink,
  isPathUnderFolder,
  normalizeDeepLinkScheme,
} from "../src/openInDainvo";

const VAULT_ID = "obsidian-0b77d6aa-4454-4405-b596-c3103e78305f";

describe("Open in Dainvo links", () => {
  it("builds task links for both desktop schemes", () => {
    expect(
      buildObsidianTaskDeepLink({
        scheme: "dainvo",
        vaultId: VAULT_ID,
        blockId: "d-Ab12Cd",
      }),
    ).toBe(`dainvo://obsidian/task/${VAULT_ID}/d-Ab12Cd`);
    expect(
      buildObsidianTaskDeepLink({
        scheme: "dainvo-dev",
        vaultId: VAULT_ID,
        blockId: "dainvo-11111111-1111-4111-8111-111111111111",
      }),
    ).toBe(
      `dainvo-dev://obsidian/task/${VAULT_ID}/dainvo-11111111-1111-4111-8111-111111111111`,
    );
  });

  it("builds project links and rejects identities the desktop would refuse", () => {
    expect(
      buildProjectDeepLink({ scheme: "dainvo", projectId: "project_12345678" }),
    ).toBe("dainvo://entity/project/project_12345678");
    expect(() =>
      buildProjectDeepLink({ scheme: "dainvo", projectId: "bad/id" }),
    ).toThrow("not valid");
    expect(() =>
      buildObsidianTaskDeepLink({
        scheme: "dainvo",
        vaultId: "short",
        blockId: "d-Ab12Cd",
      }),
    ).toThrow("not valid");
    expect(() =>
      buildObsidianTaskDeepLink({
        scheme: "dainvo",
        vaultId: VAULT_ID,
        blockId: "a b",
      }),
    ).toThrow("not valid");
  });

  it("falls back to the production scheme for anything unexpected", () => {
    expect(normalizeDeepLinkScheme("dainvo-dev")).toBe("dainvo-dev");
    expect(normalizeDeepLinkScheme("dainvo")).toBe("dainvo");
    expect(normalizeDeepLinkScheme(undefined)).toBe("dainvo");
    expect(normalizeDeepLinkScheme("https")).toBe("dainvo");
  });

  it("appends the block id as the last token of the line", () => {
    expect(appendBlockIdToTaskLine("- [ ] Ship it   ", "d-Ab12Cd")).toBe(
      "- [ ] Ship it ^d-Ab12Cd",
    );
    expect(
      appendBlockIdToTaskLine("  - [x] Done 📅 2026-09-09 #tag", "d-Zz99Yy"),
    ).toBe("  - [x] Done 📅 2026-09-09 #tag ^d-Zz99Yy");
  });

  it("recognizes notes under the Project Notes folder only", () => {
    expect(isPathUnderFolder("Projects/Board deck/Board deck.md", "Projects")).toBe(
      true,
    );
    expect(isPathUnderFolder("Projects\\Board deck\\Kickoff.md", "Projects/")).toBe(
      true,
    );
    expect(isPathUnderFolder("Projects2/x.md", "Projects")).toBe(false);
    expect(isPathUnderFolder("Projects.md", "Projects")).toBe(false);
    expect(isPathUnderFolder("Projects/x.md", "")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { sha256 } from "../src/sha256";

describe("sha256", () => {
  it("preserves the legacy Node SHA-256 identity contract", () => {
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256("Projects/Plan.md:12")).toBe(
      "4fc23b9c4703920e4e007d2b8b5168809918c72613668bb4e753fd05820ad234",
    );
  });
});

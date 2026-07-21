import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  editorLivePreviewField: {},
}));

let findDainvoStableIdRange: typeof import("../src/stableIdVisibility").findDainvoStableIdRange;

beforeAll(async () => {
  ({ findDainvoStableIdRange } = await import("../src/stableIdVisibility"));
});

describe("stable ID visibility", () => {
  it.each([
    "- [ ] Plan launch ^d-A1b2C3",
    "- [x] Finish launch ^dainvo-11111111-1111-4111-8111-111111111111",
  ])("finds the Dainvo-owned suffix on a task line", (line) => {
    const range = findDainvoStableIdRange(line);

    expect(range).not.toBeNull();
    expect(line.slice(range!.from, range!.to)).toMatch(
      /^ \^(?:dainvo|d)-/,
    );
  });

  it.each([
    "- [ ] Keep user block ID ^my-reference",
    "Text ^d-A1b2C3",
    "- [ ] No block ID",
  ])("does not hide %s", (line) => {
    expect(findDainvoStableIdRange(line)).toBeNull();
  });
});

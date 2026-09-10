import { beforeEach, describe, expect, it, vi } from "vitest";

const requestUrl = vi.fn();

vi.mock("obsidian", () => ({ requestUrl }));

let DainvoBridgeClient: typeof import("../src/bridgeClient").DainvoBridgeClient;
let DEFAULT_SETTINGS: typeof import("../src/types").DEFAULT_SETTINGS;

describe("DainvoBridgeClient.getProjectNoteLink", () => {
  beforeEach(async () => {
    requestUrl.mockReset();
    ({ DainvoBridgeClient } = await import("../src/bridgeClient"));
    ({ DEFAULT_SETTINGS } = await import("../src/types"));
  });

  it("encodes the note path and keeps a null link on the first bridge", async () => {
    const settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      bridgeBaseUrl: "http://127.0.0.1:58235",
    };
    requestUrl.mockResolvedValue({
      status: 200,
      json: { link: null },
      text: JSON.stringify({ link: null }),
    });
    const client = new DainvoBridgeClient(
      () => settings,
      () => "token-1",
    );

    await expect(
      client.getProjectNoteLink("Projects/Board deck/Board deck.md"),
    ).resolves.toEqual({ link: null });
    expect(requestUrl).toHaveBeenCalledTimes(1);
    expect(requestUrl.mock.calls[0]?.[0]).toMatchObject({
      url: "http://127.0.0.1:58235/obsidian/v1/project-notes?notePath=Projects%2FBoard%20deck%2FBoard%20deck.md",
      method: "GET",
      headers: { Authorization: "Bearer token-1" },
    });
    expect(settings.bridgeBaseUrl).toBe("http://127.0.0.1:58235");
  });

  it("returns the owning Project when the desktop reports one", async () => {
    const settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      bridgeBaseUrl: "http://127.0.0.1:58234",
    };
    const body = {
      link: { projectId: "project_1", projectName: "Board deck", blockId: null },
    };
    requestUrl.mockResolvedValue({
      status: 200,
      json: body,
      text: JSON.stringify(body),
    });
    const client = new DainvoBridgeClient(
      () => settings,
      () => "token-1",
    );

    await expect(client.getProjectNoteLink("Projects/Board deck.md")).resolves.toEqual(
      body,
    );
  });
});

import { describe, expect, it } from "vitest";

import { assertCloudConfig } from "../src/runtimeConfig";

const safeConfig = {
  supabaseUrl: "https://example.supabase.co",
  publishableKey: "sb_publishable_test",
  oauthClientId: "obsidian-client-test",
  oauthRedirectUri: "https://users.dainvo.com/auth/obsidian-callback",
};

describe("Dainvo cloud runtime configuration", () => {
  it("accepts the public client configuration", () => {
    expect(assertCloudConfig(safeConfig)).toBe(safeConfig);
  });

  it.each(["sb_secret_private", "service_role_private", "legacy-anon-key"])(
    "rejects a non-publishable client key: %s",
    (publishableKey) => {
      expect(() =>
        assertCloudConfig({ ...safeConfig, publishableKey }),
      ).toThrow("safe Supabase publishable key");
    },
  );
});

declare const __DAINVO_SUPABASE_URL__: string;
declare const __DAINVO_SUPABASE_PUBLISHABLE_KEY__: string;
declare const __DAINVO_OBSIDIAN_OAUTH_CLIENT_ID__: string;
declare const __DAINVO_OBSIDIAN_OAUTH_REDIRECT_URI__: string;

export type DainvoCloudConfig = {
  supabaseUrl: string;
  publishableKey: string;
  oauthClientId: string;
  oauthRedirectUri: string;
};

export function getDainvoCloudConfig(): DainvoCloudConfig {
  return {
    supabaseUrl: normalizeUrl(__DAINVO_SUPABASE_URL__),
    publishableKey: __DAINVO_SUPABASE_PUBLISHABLE_KEY__.trim(),
    oauthClientId: __DAINVO_OBSIDIAN_OAUTH_CLIENT_ID__.trim(),
    oauthRedirectUri:
      __DAINVO_OBSIDIAN_OAUTH_REDIRECT_URI__.trim() ||
      "https://users.dainvo.com/auth/obsidian-callback",
  };
}
export function assertCloudConfig(
  config: DainvoCloudConfig,
): DainvoCloudConfig {
  if (!config.supabaseUrl || !config.publishableKey || !config.oauthClientId) {
    throw new Error(
      "This plugin build is missing Dainvo cloud configuration. Install an official Dainvo Task Manager release.",
    );
  }

  if (
    config.oauthRedirectUri !==
    "https://users.dainvo.com/auth/obsidian-callback"
  ) {
    throw new Error("The Obsidian OAuth callback is not configured safely.");
  }

  return config;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

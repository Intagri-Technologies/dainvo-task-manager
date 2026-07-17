import esbuild from 'esbuild';

const prod = process.argv[2] === 'production';
const cloudConfig = {
  supabaseUrl: process.env.DAINVO_SUPABASE_URL ?? '',
  publishableKey: process.env.DAINVO_SUPABASE_PUBLISHABLE_KEY ?? '',
  oauthClientId: process.env.DAINVO_OBSIDIAN_OAUTH_CLIENT_ID ?? '',
  oauthRedirectUri:
    process.env.DAINVO_OBSIDIAN_OAUTH_REDIRECT_URI ??
    'https://users.dainvo.com/auth/obsidian-callback'
};

if (
  process.env.DAINVO_REQUIRE_CLOUD_CONFIG === 'true' &&
  (!cloudConfig.supabaseUrl ||
    !cloudConfig.publishableKey ||
    !cloudConfig.oauthClientId)
) {
  throw new Error('Dainvo cloud build configuration is incomplete.');
}

const context = await esbuild.context({
  banner: {
    js: '/* Dainvo Task Manager Obsidian plugin */'
  },
  bundle: true,
  define: {
    __DAINVO_SUPABASE_URL__: JSON.stringify(cloudConfig.supabaseUrl),
    __DAINVO_SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(
      cloudConfig.publishableKey
    ),
    __DAINVO_OBSIDIAN_OAUTH_CLIENT_ID__: JSON.stringify(
      cloudConfig.oauthClientId
    ),
    __DAINVO_OBSIDIAN_OAUTH_REDIRECT_URI__: JSON.stringify(
      cloudConfig.oauthRedirectUri
    )
  },
  entryPoints: ['src/main.ts'],
  external: ['obsidian', '@codemirror/autocomplete', '@codemirror/collab', '@codemirror/commands', '@codemirror/language', '@codemirror/lint', '@codemirror/search', '@codemirror/state', '@codemirror/view', '@lezer/common', '@lezer/highlight', '@lezer/lr'],
  format: 'cjs',
  logLevel: 'info',
  minify: prod,
  outfile: 'main.js',
  platform: 'browser',
  sourcemap: prod ? false : 'inline',
  target: 'es2022',
  treeShaking: true
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}

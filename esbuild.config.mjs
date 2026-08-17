import esbuild from 'esbuild';

import { DAINVO_PUBLIC_CLOUD_CONFIG } from './publicCloudConfig.mjs';

const prod = process.argv[2] === 'production';
const cloudConfig = prod
  ? DAINVO_PUBLIC_CLOUD_CONFIG
  : {
      supabaseUrl:
        process.env.DAINVO_SUPABASE_URL ??
        DAINVO_PUBLIC_CLOUD_CONFIG.supabaseUrl,
      publishableKey:
        process.env.DAINVO_SUPABASE_PUBLISHABLE_KEY ??
        DAINVO_PUBLIC_CLOUD_CONFIG.publishableKey,
      oauthClientId:
        process.env.DAINVO_OBSIDIAN_OAUTH_CLIENT_ID ??
        DAINVO_PUBLIC_CLOUD_CONFIG.oauthClientId,
      oauthRedirectUri:
        process.env.DAINVO_OBSIDIAN_OAUTH_REDIRECT_URI ??
        DAINVO_PUBLIC_CLOUD_CONFIG.oauthRedirectUri
    };

if (!cloudConfig.publishableKey.startsWith('sb_publishable_')) {
  throw new Error('Dainvo public builds require a Supabase publishable key.');
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

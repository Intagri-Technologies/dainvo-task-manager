import esbuild from 'esbuild';

const prod = process.argv[2] === 'production';

const context = await esbuild.context({
  banner: {
    js: '/* Dainvo Task Manager Obsidian plugin */'
  },
  bundle: true,
  entryPoints: ['src/main.ts'],
  external: ['obsidian', 'electron', '@codemirror/autocomplete', '@codemirror/collab', '@codemirror/commands', '@codemirror/language', '@codemirror/lint', '@codemirror/search', '@codemirror/state', '@codemirror/view', '@lezer/common', '@lezer/highlight', '@lezer/lr'],
  format: 'cjs',
  logLevel: 'info',
  minify: prod,
  outfile: 'main.js',
  platform: 'node',
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


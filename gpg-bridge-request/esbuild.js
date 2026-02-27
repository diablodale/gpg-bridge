const esbuild = require('esbuild');

const production = process.argv.includes('--production');

esbuild
  .build({
    entryPoints: ['./src/extension.ts'],
    bundle: true,
    outfile: './out/extension.js',
    format: 'cjs',
    platform: 'node',
    external: ['vscode'],
    minify: production,
    sourcemap: !production,
    logLevel: 'info',
  })
  .catch(() => process.exit(1));

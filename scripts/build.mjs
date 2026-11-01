import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  // Some bundled CommonJS dependencies call require() on Node built-ins.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
  }
})

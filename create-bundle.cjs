const { NodeGlobalsPolyfillPlugin } = require('@esbuild-plugins/node-globals-polyfill');

require('esbuild').build({
  entryPoints : ['./src/index.ts'],
  bundle      : true,
  minify      : true,
  sourcemap   : true,
  target      : ['chrome101'],
  plugins     : [NodeGlobalsPolyfillPlugin({ process: true })],
  outfile     : 'dist/bundles/index.cjs',
});
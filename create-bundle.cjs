const { NodeGlobalsPolyfillPlugin } = require('@esbuild-plugins/node-globals-polyfill');

require('esbuild').build({
  entryPoints : ['./src/index.ts'],
  bundle      : true,
  // minify      : true,
  format      : 'esm',
  sourcemap   : true,
  platform    : 'browser',
  target      : ['chrome101'],
  plugins     : [NodeGlobalsPolyfillPlugin({ process: true })],
  define      : {
    'global': 'window'
  },
  outfile: 'dist/bundles/browser.js',
});
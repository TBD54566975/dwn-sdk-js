const { NodeGlobalsPolyfillPlugin } = require('@esbuild-plugins/node-globals-polyfill');

module.exports = {
  entryPoints : ['./src/index.ts'],
  bundle      : true,
  format      : 'esm',
  sourcemap   : true,
  platform    : 'browser',
  target      : ['chrome101'],
  plugins     : [NodeGlobalsPolyfillPlugin({ process: true })],
  define      : {
    'global': 'window'
  }
};
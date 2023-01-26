const polyfillProviderPlugin = require('node-stdlib-browser/helpers/esbuild/plugin');
const stdLibBrowser = require('node-stdlib-browser');

/** @type {import('esbuild').BuildOptions} */
module.exports = {
  entryPoints : ['./src/index.ts'],
  bundle      : true,
  format      : 'esm',
  sourcemap   : true,
  minify      : true,
  platform    : 'browser',
  target      : ['chrome101', 'firefox108', 'safari16'],
  inject      : [require.resolve('node-stdlib-browser/helpers/esbuild/shim')],
  plugins     : [polyfillProviderPlugin(stdLibBrowser)],
  define      : {
    'global': 'globalThis'
  }
};
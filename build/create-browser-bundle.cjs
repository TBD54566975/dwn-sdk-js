const browserConfig = require('./esbuild-browser-config.cjs');

require('esbuild').build({
  ...browserConfig,
  outfile: 'dist/bundles/browser.js',
});
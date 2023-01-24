const browserConfig = require('./esbuild-browser-config.cjs');
const fs = require('fs');

require('esbuild').build({
  ...browserConfig,
  metafile : true,
  outfile  : 'dist/bundles/browser.js',
}).then(result => {
  const serializedMetafile = JSON.stringify(result.metafile, null, 4);
  fs.writeFileSync(`${__dirname}/../bundle-metadata.json`, serializedMetafile, { encoding: 'utf8' });
});
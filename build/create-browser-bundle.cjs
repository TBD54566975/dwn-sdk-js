const fs = require('fs');
const esbuild = require('esbuild');
const browserConfig = require('./esbuild-browser-config.cjs');

esbuild.build({
  ...browserConfig,
  outfile   : 'dist/bundles/dwn.js',
  metafile  : true,
  sourcemap : false,
}).then(result => {
  const serializedMetafile = JSON.stringify(result.metafile, null, 4);
  fs.writeFileSync(`${__dirname}/../bundle-metadata.json`, serializedMetafile, { encoding: 'utf8' });
});

esbuild.build({
  ...browserConfig,
  entryPoints : ['./src/index-stores.ts'],
  outfile     : 'dist/bundles/level-stores.js',
  sourcemap   : false,
});
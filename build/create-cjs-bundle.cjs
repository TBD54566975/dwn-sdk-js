const esbuild = require('esbuild');
const packageJson = require('../package.json');

// list of dependencies that _dont_ ship cjs
const includeList = new Set([
  '@ipld/dag-cbor',
  '@noble/ed25519',
  '@noble/secp256k1',
  'blockstore-core',
  'ipfs-unixfs-exporter',
  'ipfs-unixfs-importer',
  'multiformats'
]);

// create list of dependencies that we _do not_ want to include in our bundle
const excludeList = [];
for (const dependency in packageJson.dependencies) {
  if (includeList.has(dependency)) {
    continue;
  } else {
    excludeList.push(dependency);
  }
}

/** @type {import('esbuild').BuildOptions} */
const baseConfig = {
  platform : 'node',
  format   : 'cjs',
  bundle   : true,
  external : excludeList,
};

const indexConfig = {
  ...baseConfig,
  entryPoints : ['./dist/esm/src/index.js'],
  outfile     : './dist/cjs/index.js',
};

esbuild.buildSync(indexConfig);

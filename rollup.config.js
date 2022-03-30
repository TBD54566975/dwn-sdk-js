// uses babel to transpile.
import babel from '@rollup/plugin-babel';

// convert CommonJS modules to ES6, so they can be included in a Rollup bundle.
// many 3rd party dependencies are exported as commonJS modules
import commonjs from '@rollup/plugin-commonjs';

// resolves imports to other node packages.
import resolve from '@rollup/plugin-node-resolve';

// Converts .json files to ES6 modules. used specifically for the JSON schemas we use to validate
// message payloads
import json from '@rollup/plugin-json';

// includes polyfills for node-native modules (e.g. buffer)
// info on available polyfills is available here -
// https://www.npmjs.com/package/rollup-plugin-polyfill-node
import nodePolyfills from 'rollup-plugin-polyfill-node';

//  minification
import { terser } from 'rollup-plugin-terser';

export default  {
  input  : 'src/index.ts',
  output : [
    {
      file      : 'dist/bundles/bundle.esm.js',
      format    : 'esm',
      sourcemap : true
    },
    {
      file      : 'dist/bundles/bundle.esm.min.js',
      format    : 'esm',
      plugins   : [terser()],
      sourcemap : true
    },
    {
      file      : 'dist/bundles/bundle.umd.js',
      format    : 'umd',
      name      : 'hubSDK',
      sourcemap : true
    },
    {
      file      : 'dist/bundles/bundle.umd.min.js',
      format    : 'umd',
      name      : 'hubSDK',
      plugins   : [terser()],
      sourcemap : true
    }
  ],
  plugins: [
    commonjs(),
    babel({
      babelHelpers : 'bundled',
      include      : ['src/**/*.ts'],
      extensions   : ['.js', '.ts' ],
      exclude      : './node_modules/**'
    }),
    json(),
    resolve({
      preferBuiltins : false,
      extensions     : ['.js', '.ts' ],
      mainFields     : ['browser']
    }),
    nodePolyfills({
      include: null
    }),
  ]
};

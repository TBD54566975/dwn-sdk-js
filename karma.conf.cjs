// Karma is what we're using to run our tests in browser environments
// Karma does not support .mjs

// uses babel to transpile.
const { babel } = require('@rollup/plugin-babel');

// convert CommonJS modules to ES6, so they can be included in a Rollup bundle.
// many 3rd party dependencies are exported as commonJS modules
const commonjs = require('@rollup/plugin-commonjs/dist/index');

// resolves imports to other node packages.
const resolve = require('@rollup/plugin-node-resolve').default;

// Converts .json files to ES6 modules. used specifically for the JSON schemas we use to validate
// message payloads
const json = require('@rollup/plugin-json');

// includes polyfills for node-native modules (e.g. buffer)
// info on available polyfills is available here -
// https://www.npmjs.com/package/rollup-plugin-polyfill-node
const nodePolyfills = require('rollup-plugin-polyfill-node');

const rollupPlugins = [
  commonjs(),
  babel({
    babelHelpers : 'runtime',
    extensions   : ['.js', '.ts' ],
    exclude      : ['./node_modules/**']
  }),
  json(),
  resolve({
    extensions     : ['.js', '.ts' ],
    preferBuiltins : false,
    mainFields     : ['browser']
  }),
  nodePolyfills({
    include: null
  })
];

module.exports = function(config) {
  config.set({
    plugins: [
      require('karma-chrome-launcher'),
      require('karma-rollup-preprocessor'),
      require('karma-mocha'),
      require('karma-mocha-reporter')
    ],

    // frameworks to use
    // available frameworks: https://www.npmjs.com/search?q=keywords:karma-adapter
    frameworks: ['mocha'],


    // list of files / patterns to load in the browser
    files: [
      { pattern: 'tests/**/*.ts', watched: false }
    ],
    // preprocess matching files before serving them to the browser
    // available preprocessors: https://www.npmjs.com/search?q=keywords:karma-preprocessor
    preprocessors: {
      'tests/**/*.ts': ['rollup']
    },

    rollupPreprocessor: {
      output: {
        name      : 'dwnSDK',
        format    : 'iife',
        sourcemap : 'inline',
      },
      plugins: rollupPlugins,
    },

    // list of files / patterns to exclude
    exclude: [],

    // test results reporter to use
    // available reporters: https://www.npmjs.com/search?q=keywords:karma-reporter
    reporters: ['mocha'],

    // web server port
    port: 9876,

    // enable / disable colors in the output (reporters and logs)
    colors: true,

    // level of logging
    // possible values: config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN ||
    // config.LOG_INFO || config.LOG_DEBUG
    logLevel: config.LOG_INFO,

    // start these browsers
    // available browser launchers: https://www.npmjs.com/search?q=keywords:karma-launcher
    browsers: ['ChromeHeadless'],

    // Continuous Integration mode
    // if true, Karma captures browsers, runs the tests and exits
    singleRun: true,
  });
};

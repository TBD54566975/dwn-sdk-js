// Karma is what we're using to run our tests in browser environments
// Karma does not support .mjs

const esbuildBrowserConfig = require('./build/esbuild-browser-config.cjs');

module.exports = function(config) {
  config.set({
    plugins: [
      require('karma-chrome-launcher'),
      require('karma-esbuild'),
      require('karma-mocha'),
      require('karma-mocha-reporter')
    ],

    // frameworks to use
    // available frameworks: https://www.npmjs.com/search?q=keywords:karma-adapter
    frameworks: ['mocha'],


    // list of files / patterns to load in the browser
    files: [
      { pattern: 'tests/**/*.spec.ts', watched: false }
    ],
    // preprocess matching files before serving them to the browser
    // available preprocessors: https://www.npmjs.com/search?q=keywords:karma-preprocessor
    preprocessors: {
      'tests/**/*.ts': ['esbuild']
    },

    esbuild: esbuildBrowserConfig,

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
    browsers: [
      'ChromeDebugging'
    ],

    customLaunchers: {
      ChromeDebugging: {
        base  : 'Chrome',
        flags : [ '--remote-debugging-port=9333' ]
      }
    }
  });
};

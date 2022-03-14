const sharedPresets = ['@babel/typescript'];
const shared = {
  ignore: ['tests/**/*.ts'],
  presets: sharedPresets
}

module.exports = {
  env: {
    // typescript -> javascript. no bundling involved, making this the
    // most modern distribution of the lib available. Downstream consumers
    // can choose how they want to process it
    esm: shared,
    // bundled version of `esm`. Transpiles to version of JS most-supported
    // across browsers and node. Version is decided by
    // https://babeljs.io/docs/en/babel-preset-env
    esmBundled: {
      ...shared,
      presets: [['@babel/env', {
        targets: "> 0.25%, not dead"
      }], ...sharedPresets],
    },
    // similar to esm in purpose.
    cjs: {
      ...shared,
      presets: [['@babel/env', {
        modules: 'commonjs'
      }], ...sharedPresets],
    }
  }
}
module.exports = {
  env: {
    // typescript -> javascript. no bundling involved, making this the
    // most modern distribution of the lib available. Downstream consumers
    // can choose how they want to process it
    esm: {
      ignore: ['tests/**/*.ts'],
      presets: [
        ['@babel/typescript', {
          onlyRemoveTypeImports: true
        }]
      ],
      plugins: ['@babel/plugin-proposal-class-properties']
    },
    // bundled version of `esm`. Transpiles to version of JS most-supported
    // across browsers and node. Version is decided by
    // https://babeljs.io/docs/en/babel-preset-env
    esmBundled: {
      ignore: ['tests/**/*.ts'],
      plugins: ['@babel/plugin-proposal-class-properties'],
      presets: [
        ['@babel/env', {
          targets: "> 0.25%, not dead"
        }],
        ['@babel/typescript', {
          onlyRemoveTypeImports: true
        }]
      ],
    },

    // bundle that includes tests. Used to run tests in browsers
    test: {
      plugins: [
        '@babel/plugin-proposal-class-properties',
        ["@babel/plugin-transform-runtime", {
          "regenerator": true
        }]
      ],
      presets: [
        ['@babel/env', {
          targets: "> 0.25%, not dead"
        }],
        ['@babel/typescript', {
          onlyRemoveTypeImports: true
        }]
      ],
    },
    // similar to esm in purpose.
    cjs: {
      ignore: ['tests/**/*.ts'],
      plugins: ['@babel/plugin-proposal-class-properties'],
      presets: [
        ['@babel/env', {
          modules: 'commonjs'
        }],
        '@babel/typescript',
      ],
    }
  }
}
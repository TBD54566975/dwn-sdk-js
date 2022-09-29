module.exports = {
  parser        : '@typescript-eslint/parser',
  parserOptions : {
    ecmaVersion : 'latest', // Allows the use of modern ECMAScript features
    sourceType  : 'module', // Allows for the use of imports
  },
  plugins: [
    '@typescript-eslint',
  ],
  env: {
    node    : true, // Enable Node.js global variables
    browser : true
  },
  rules: {
    'no-console' : 'off',
    'indent'     : [
      'error',
      2
    ],
    'object-curly-spacing' : ['error', 'always'],
    'linebreak-style'      : [
      'error',
      'unix'
    ],
    'quotes': [
      'error',
      'single',
      { 'allowTemplateLiterals': true }
    ],
    'semi'                    : ['off'],
    '@typescript-eslint/semi' : ['error', 'always'],
    'no-multi-spaces'         : ['error'],
    'no-trailing-spaces'      : ['error'],
    'max-len'                 : ['error', { 'code': 200 }],
    'key-spacing'             : [
      'error',
      {
        'align': {
          'beforeColon' : true,
          'afterColon'  : true,
          'on'          : 'colon'
        }
      }
    ],
    'keyword-spacing'                                  : ['error', { 'before': true, 'after': true }],
    '@typescript-eslint/explicit-function-return-type' : ['error'],
    'no-unused-vars'                                   : 'off',
    '@typescript-eslint/no-unused-vars'                : [
      'error',
      {
        'vars'               : 'all',
        'args'               : 'after-used',
        'ignoreRestSiblings' : true,
        'argsIgnorePattern'  : '^_'
      }
    ],
    'prefer-const': ['error', { 'destructuring': 'all' }]
  }
};
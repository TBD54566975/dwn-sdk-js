module.exports = {
  parser        : '@typescript-eslint/parser',
  parserOptions : {
    ecmaVersion : 'latest', // Allows the use of modern ECMAScript features
    sourceType  : 'module', // Allows for the use of imports
  },
  plugins: [
    '@typescript-eslint',
    'todo-plz' // for enforcing TODO formatting to require "github.com/TBD54566975/dwn-sdk-js/issues/"
  ],
  env: {
    node    : true, // Enable Node.js global variables
    browser : true
  },
  rules: {
    'curly'      : ['error', 'all'],
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
    '@typescript-eslint/semi' : ['error', 'always'],
    'semi'                    : ['off'],
    'no-multi-spaces'         : ['error'],
    'no-trailing-spaces'      : ['error'],
    'max-len'                 : ['error', { 'code': 150, 'ignoreStrings': true }],
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
    // enforce `import type` when an import is not used at runtime, allowing transpilers/bundlers to drop imports as an optimization
    '@typescript-eslint/consistent-type-imports'       : 'error',
    '@typescript-eslint/no-unused-vars'                : [
      'error',
      {
        'vars'               : 'all',
        'args'               : 'after-used',
        'ignoreRestSiblings' : true,
        'argsIgnorePattern'  : '^_',
        'varsIgnorePattern'  : '^_'
      }
    ],

    'prefer-const' : ['error', { 'destructuring': 'all' }],
    'sort-imports' : ['error', {
      'ignoreCase'            : true,
      'ignoreDeclarationSort' : false,
      'ignoreMemberSort'      : false,
      'memberSyntaxSortOrder' : ['none', 'all', 'single', 'multiple'],
      'allowSeparatedGroups'  : true
    }],
    // enforce github issue reference for every TO-DO comment
    'todo-plz/ticket-ref': ['error', { 'commentPattern': '.*github\.com\/TBD54566975\/dwn-sdk-js\/issues\/.*' }],
  }
};

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
      'warn',
      2
    ],
    'linebreak-style': [
      'error',
      'unix'
    ],
    'quotes': [
      'error',
      'single',
      { 'allowTemplateLiterals': true }
    ],
    'semi': [
      'error',
      'always'
    ],
    'no-trailing-spaces' : ['warn'],
    'max-len'            : ['warn', { 'code': 100 }],
    'key-spacing'        : [
      'error',
      {
        'align': {
          'beforeColon' : true,
          'afterColon'  : true,
          'on'          : 'colon'
        }
      }
    ]
  }
};
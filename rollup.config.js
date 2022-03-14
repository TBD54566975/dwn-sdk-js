// uses babel to transpile.
import babel from '@rollup/plugin-babel';
// resolves imports to other node packages.
import resolve from '@rollup/plugin-node-resolve';

//  minification
import { terser } from 'rollup-plugin-terser';

const extensions = ['.js', '.ts' ];

export default  {
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/bundles/bundle.esm.js',
      format: 'esm',
      sourcemap: true
    },
    {
      file: 'dist/bundles/bundle.esm.min.js',
      format: 'esm',
      plugins: [terser()],
      sourcemap: true
    },
    {
      file: 'dist/bundles/bundle.umd.js',
      format: 'umd',
      name: 'hubSDK',
      sourcemap: true
    },
    {
      file: 'dist/bundles/bundle.umd.min.js',
      format: 'umd',
      name: 'hubSDK',
      plugins: [terser()],
      sourcemap: true
    }
  ],
  plugins: [
    resolve({ extensions }),
    babel({
      babelHelpers: 'bundled',
      include: ['src/**/*.ts'],
      extensions,
      exclude: './node_modules/**'
    })
  ]
};

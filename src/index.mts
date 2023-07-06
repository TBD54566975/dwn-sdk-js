// NOTE: introduced this separate exports file for EMS exports so that we can export tests just for the EMS module, because:
// 1. tests use `import` statements to import JSON files, and
// 2. nodejs requires imports of JSON files to include import assertion for ESM module, but
// 3. TypeScript compiler only allows static imports with import assertion syntax when transpiling for an ESM module, not CJS, and
// 4. we need to build CJS module for Electron app support, and
// 5. There is no feature for TypeSCript compiler to automatically generate import assertions if the import assertions are omitted in source TS code

export * from './index.js';
export { TestSuite } from '../tests/test-suite.js';

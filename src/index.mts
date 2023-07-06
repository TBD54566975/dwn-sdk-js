// NOTE: introduced this separate exports file for specifically EMS exports so that we only include tests for the EMS module, because:
// 1. tests use `import` statements to import JSON files, and
// 2. nodejs requires imports of JSON files to include import assertion for ESM module, but
// 3. TypeScript compiler only supports static import with import assertion syntax building for ESM, not CJS, and
// 4. we need to build CJS module for Electron app support, and
// 5. TypeSCript compiler does not provide a way to automatically import assertions just for ESM module

export * from './index.js';
export { TestSuite } from '../tests/test-suite.js';

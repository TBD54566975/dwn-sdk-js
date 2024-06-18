import { TestSuite } from './test-suite.js';

describe('Store dependent tests', () => {
  TestSuite.runInjectableDependentTests();
});
import { TestSuite } from './test-suite.js';

describe('Store dependent tests', () => {
  it('should all work', async () => {
    TestSuite.runStoreDependentTests();
  });
});
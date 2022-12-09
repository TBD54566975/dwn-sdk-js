import { expect } from 'chai';
import { removeUndefinedProperties } from '../../src/utils/object.js';

describe('Object', () => {
  describe('removeUndefinedProperties', () => {
    it('should remove all `undefined` properties of a nested object', () => {
      const mockObject = {
        a : true,
        b : undefined,
        c : {
          a : 0,
          b : undefined,
        }
      };
      const expectedResult = {
        a : true,
        c : {
          a: 0
        }
      };

      removeUndefinedProperties(mockObject);

      expect(mockObject).to.deep.equal(expectedResult);
    });
  });
});
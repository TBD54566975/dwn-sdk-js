import { expect } from 'chai';
import { removeEmptyObjects, removeEmptyStrings, removeUndefinedProperties } from '../../src/utils/object.js';

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

  describe('removeEmptyObjects', () => {
    it('should remove all empty objects', () => {
      const obj = {
        foo  : {},
        bar  : { baz: {} },
        buzz : 'hello'
      };
      removeEmptyObjects(obj);

      expect(obj).to.deep.equal({ buzz: 'hello' });
    });
  });

  describe('removeEmptyStrings', () => {
    it('should remove all empty strings', () => {
      const obj = {
        foo  : '',
        bar  : { baz: '' },
        buzz : 'hello'
      };
      removeEmptyStrings(obj);
      expect(obj).to.deep.equal({ bar: {}, buzz: 'hello' });
    });
  });
});
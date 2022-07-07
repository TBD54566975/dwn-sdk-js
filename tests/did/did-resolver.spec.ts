import { expect } from 'chai';
import { validateDID } from '../../src/did/did-resolver';

const VALID_DID_EXAMPLE = 'did:example:123456789abcdefghijk';
const INVALID_DID_EXAMPLE = 'did:123456789abcdefghijk';

describe('DIDResolver Tests', () => {
  describe('validateDID', () => {
    it('valid DID', () => {
      expect(() => validateDID(VALID_DID_EXAMPLE)).to.not.throw();
    });

    it('invalid DID', () => {
      expect(() => validateDID(null)).to.throw(TypeError);
      expect(() => validateDID(INVALID_DID_EXAMPLE)).to.throw(TypeError);
    });
  });
});

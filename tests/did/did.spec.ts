import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Did } from '../../src/did/did';

// extends chai to test promises
chai.use(chaiAsPromised);

describe('Did.validate', () => {
  it('should pass validation for valid DIDs', () => {
    expect(() => Did.validate('did:example:123456789abcdefghijk')).to.not.throw();
    expect(() => Did.validate('did:ethr:mainnet:0xb9c5714089478a327f09197987f16f9e5d936e8a')).to.not.throw();

  });

  it('should fail validation for valid DIDs', () => {
    expect(() => Did.validate(null)).to.throw(Error);
    expect(() => Did.validate('did:123456789abcdefghijk')).to.throw(Error);
  });
});

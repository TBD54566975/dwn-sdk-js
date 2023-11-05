import { authenticate } from '../../src/core/auth.js';
import { DidResolver } from '../../src/index.js';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { expect } from 'chai';

describe('Auth', () => {
  describe('authenticate()', () => {
    it('should throw if given JWS is `undefined`', async () => {
      const jws = undefined;
      await expect(authenticate(jws, new DidResolver)).to.be.rejectedWith(DwnErrorCode.AuthenticateJwsMissing);
    });
  });
});
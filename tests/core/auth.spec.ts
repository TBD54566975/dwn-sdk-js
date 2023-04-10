import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { expect } from 'chai';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { authenticate, validateAuthorizationIntegrity } from '../../src/core/auth.js';
import { DidResolver, RecordsRead } from '../../src/index.js';

describe('Auth', () => {
  describe('validateAuthorizationIntegrity()', () => {
    it('should throw if given message does not have `authorization` property', async () => {
      // create a message without `authorization`
      const recordsRead = await RecordsRead.create({
        recordId: await TestDataGenerator.randomCborSha256Cid()
      });

      await expect(validateAuthorizationIntegrity(recordsRead.message)).to.be.rejectedWith(DwnErrorCode.AuthorizationMissing);
    });
  });

  describe('authenticate()', () => {
    it('should throw if given JWS is `undefined`', async () => {
      const jws = undefined;
      await expect(authenticate(jws, new DidResolver)).to.be.rejectedWith(DwnErrorCode.AuthenticateJwsMissing);
    });
  });
});
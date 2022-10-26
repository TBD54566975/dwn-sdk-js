describe('GeneralJwsVerifier', () => {
  describe('getPublicKey', () => {
    xit('throws an exception if publicKeyJwk isn\'t present in verificationMethod', () => {});
    xit('throws an exception if DID could not be resolved', () => {});
    xit('throws an exception if appropriate key isnt present in DID Doc', () => {});
    xit('throws an exception if verificationMethod type isn\'t JsonWebKey2020', () => {});
    xit('returns public key', () => {});
  });
  describe('verifySignature', () => {
    xit('throws an exception if signature does not match', () => {});
    xit('returns true if signature is successfully verified', () => {});
  });
  describe('extractDid', () => {});
});
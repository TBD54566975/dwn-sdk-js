describe('Auth', () => {
  describe('authenticate', () => {
    xit('adds descriptorCid to payload', () => {});
    xit('includes additional provided properties to payload', () => {});
  });
  describe('verifyAuth', () => {
    xit('throws an exception if more than 1 signature is included', () => {});
    xit('throws an exception if payload is not a valid JSON object', () => {});
    xit('throws an exception if descriptorCid is not present in payload', () => {});
    xit('throws an exception if descriptorCid is not a valid CID', () => {});
    xit('throws an exception if descriptorCid does not match CID of descriptor', () => {});
    xit('throws an exception if payload includes unexpected property', () => {});
    xit('throws an exception if value of payload property fails validation', () => {});
    xit('returns parsed payload and array of signers if verification is successful', () => {});
  });
});
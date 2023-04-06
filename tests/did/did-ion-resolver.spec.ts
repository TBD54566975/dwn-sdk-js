import chaiAsPromised from 'chai-as-promised';
import fetch from 'cross-fetch';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DidIonResolver } from '../../src/did/did-ion-resolver.js';

// extends chai to test promises
chai.use(chaiAsPromised);

describe('DidIonResolver', () => {
  const defaultResolutionEndpoint = 'https://discover.did.msidentity.com/1.0/identifiers/';
  let networkAvailable = false;
  before(async () => {
    // test network connectivity, `networkAvailable` is used by tests to decide whether to run tests through real network calls or stubs
    const testDidUrl = `${defaultResolutionEndpoint}did:ion:EiClkZMDxPKqC9c-umQfTkR8vvZ9JPhl_xLDI9Nfk38w5w`;

    try {
      const response = await fetch(testDidUrl);

      if (response.status === 200) {
        networkAvailable = true;
      }
    } catch {
      // no op, all tests will run through stubs
    }
  });

  it('should set a default resolution endpoint when none is given in constructor', async () => {
    const didIonResolver = new DidIonResolver();

    expect(didIonResolver['resolutionEndpoint']).to.equal(defaultResolutionEndpoint);
  });

  it('should resolve an ION DID correctly', async () => {
    const did = 'did:ion:EiClkZMDxPKqC9c-umQfTkR8vvZ9JPhl_xLDI9Nfk38w5w';
    const didIonResolver = new DidIonResolver();

    // stub network call if network is not available
    if (!networkAvailable) {
      sinon.stub(globalThis as any, 'fetch').resolves({
        status : 200,
        json   : async () => Promise.resolve({
          didDocument         : { id: did },
          didDocumentMetadata : { canonicalId: did }
        })
      });
    }

    const resolutionDocument = await didIonResolver.resolve(did);
    expect(resolutionDocument.didDocument?.id).to.equal(did);
    expect(resolutionDocument.didDocumentMetadata.canonicalId).to.equal(did);
  });

  it('should throw if ION DID cannot be resolved', async () => {
    const did = 'did:ion:SomethingThatCannotBeResolved';
    const didIonResolver = new DidIonResolver();

    // stub network call if network is not available
    if (!networkAvailable) {
      sinon.stub(globalThis as any, 'fetch').resolves({ status: 404 });
    }

    const resolutionPromise = didIonResolver.resolve(did);
    await expect(resolutionPromise).to.be.rejectedWith('unable to resolve');
  });
});

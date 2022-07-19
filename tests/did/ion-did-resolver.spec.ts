import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import fetch from 'cross-fetch';
import { IonDidResolver } from '../../src/did/ion-did-resolver';

// extends chai to test promises
chai.use(chaiAsPromised);

describe('IonDidResolver', () => {
  const resolutionEndpoint = 'https://beta.discover.did.microsoft.com/1.0/identifiers/';
  let networkAvailable = false;
  before(async () => {
    // test network connectivity, `networkAvailable` is used by tests to decide whether to run tests through real network calls or stubs
    const testDid = 'https://beta.discover.did.microsoft.com/1.0/identifiers/did:ion:EiClkZMDxPKqC9c-umQfTkR8vvZ9JPhl_xLDI9Nfk38w5w';

    try {
      const response = await fetch(testDid);

      if (response.status === 200) {
        networkAvailable = true;
      }
    } catch {
      // no op, all tests will run through stubs
    }
  });

  it('should set a default resolution endpoint when none is given in constructor',  async () => {
    const ionDidResolver = new IonDidResolver();

    expect(ionDidResolver['resolutionEndpoint']).to.equal('https://beta.discover.did.microsoft.com/1.0/identifiers/');
  });

  it('should resolve an ION DID correctly',  async () => {
    const did = 'did:ion:EiClkZMDxPKqC9c-umQfTkR8vvZ9JPhl_xLDI9Nfk38w5w';
    const ionDidResolver = new IonDidResolver(resolutionEndpoint);

    // stub network call if network is not available
    if (!networkAvailable) {
      sinon.stub(ionDidResolver as any, 'fetch').resolves({
        status : 200,
        json   : async () => Promise.resolve({
          didDocument         : { id: did },
          didDocumentMetadata : { canonicalId: did }
        })
      });
    }

    const resolutionDocument = await ionDidResolver.resolve(did);
    expect(resolutionDocument.didDocument.id).to.equal(did);
    expect(resolutionDocument.didDocumentMetadata.canonicalId).to.equal(did);
  });

  it('should throw if ION DID cannot be resolved',  async () => {
    const did = 'did:ion:SomethingThatCannotBeResolved';
    const ionDidResolver = new IonDidResolver(resolutionEndpoint);

    // stub network call if network is not available
    if (!networkAvailable) {
      sinon.stub(ionDidResolver as any, 'fetch').resolves({ status: 404 });
    }

    const resolutionPromise = ionDidResolver.resolve(did);
    await expect(resolutionPromise).to.be.rejectedWith('unable to resolve');
  });
});

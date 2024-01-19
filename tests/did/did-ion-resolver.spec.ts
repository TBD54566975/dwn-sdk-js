import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { DidIonResolver } from '../../src/did/did-ion-resolver.js';

// extends chai to test promises
chai.use(chaiAsPromised);

describe('DidIonResolver', () => {
  const defaultResolutionEndpoint = 'https://ion.tbd.engineering/identifiers/';

  it('should set a default resolution endpoint when none is given in constructor', async () => {
    const didIonResolver = new DidIonResolver();

    expect(didIonResolver['resolutionEndpoint']).to.equal(defaultResolutionEndpoint);
  });

  it('should resolve an ION DID correctly', async () => {
    const did = 'did:ion:EiClkZMDxPKqC9c-umQfTkR8vvZ9JPhl_xLDI9Nfk38w5w';
    const didIonResolver = new DidIonResolver();

    const resolutionDocument = await didIonResolver.resolve(did);
    expect(resolutionDocument.didDocument?.id).to.equal(did);
    expect(resolutionDocument.didDocumentMetadata.canonicalId).to.equal(did);
  });

  it('should throw if ION DID cannot be resolved', async () => {
    const did = 'did:ion:SomethingThatCannotBeResolved';
    const didIonResolver = new DidIonResolver();

    const resolutionPromise = didIonResolver.resolve(did);
    await expect(resolutionPromise).to.be.rejectedWith('unable to resolve');
  });
});

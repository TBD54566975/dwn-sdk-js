import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { DidIonResolver } from '../../src/did/did-ion-resolver';
import { DidResolver } from '../../src/did/did-resolver';

// extends chai to test promises
chai.use(chaiAsPromised);

describe('DidResolver', () => {
  it('should pick the right DID resolver based on DID method name', async () => {
    const did = 'did:ion:unusedDid';
    const didIonResolver = new DidIonResolver('unusedResolutionEndpoint');
    const didResolver = new DidResolver([didIonResolver]);

    const ionDidResolveSpy = sinon.stub(didIonResolver, 'resolve').resolves({
      didDocument           : 'unused' as any,
      didDocumentMetadata   : 'unused' as any,
      didResolutionMetadata : 'unused' as any
    });
    await didResolver.resolve(did);

    expect(ionDidResolveSpy.called).to.be.true;
  });
});

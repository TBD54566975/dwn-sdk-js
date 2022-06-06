import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { IonDidResolver } from '../../src/did/ion-did-resolver';
import { DIDResolver } from '../../src/did/did-resolver';

// extends chai to test promises
chai.use(chaiAsPromised);

describe('DIDResolver', () => {
  it('should pick the right DID resolver based on DID method name',  async () => {
    const did = 'did:ion:unusedDid';
    const ionDidResolver = new IonDidResolver('unusedResolutionEndpoint');
    const didResolver = new DIDResolver([ionDidResolver]);

    const ionDidResolveSpy = sinon.stub(ionDidResolver, 'resolve').resolves({
      didDocument           : 'unused' as any,
      didDocumentMetadata   : 'unused' as any,
      didResolutionMetadata : 'unused' as any
    });
    await didResolver.resolve(did);

    expect(ionDidResolveSpy.called).to.be.true;
  });
});

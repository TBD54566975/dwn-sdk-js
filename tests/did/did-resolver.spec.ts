import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { DidIonResolver } from '../../src/did/did-ion-resolver';
import { DidResolver } from '../../src/did/did-resolver';
import { MemoryCache } from '../../src/utils/memory-cache';

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
  it('should pick the right DID resolver based on DID method name and account for passed in cache', async () => {
    const did = 'did:ion:unusedDid';
    const didIonResolver = new DidIonResolver('unusedResolutionEndpoint');
    const cache = new MemoryCache(700);
    const didResolver = new DidResolver([didIonResolver], cache);
    const ionDidResolveSpy = sinon.stub(didIonResolver, 'resolve').resolves({
      didDocument           : 'unused' as any,
      didDocumentMetadata   : 'unused' as any,
      didResolutionMetadata : 'unused' as any
    });
    const result = await didResolver.cache.get(did);
    if (result === undefined){
      await didResolver.resolve(did);
    }

    expect(ionDidResolveSpy.called).to.be.true;
  });
});

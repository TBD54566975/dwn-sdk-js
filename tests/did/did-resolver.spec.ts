import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DidIonResolver } from '../../src/did/did-ion-resolver.js';
import { DidResolver } from '../../src/did/did-resolver.js';

// extends chai to test promises
chai.use(chaiAsPromised);

describe('DidResolver', () => {
  it('should cache the resolution result and use the cached result when available', async () => {
    const did = 'did:ion:unusedDid';
    const didIonResolver = new DidIonResolver('unusedResolutionEndpoint');
    const didResolver = new DidResolver([didIonResolver]);

    const mockResolution = {
      didDocument           : 'any' as any,
      didDocumentMetadata   : 'any' as any,
      didResolutionMetadata : 'any' as any
    };
    const ionDidResolveSpy = sinon.stub(didIonResolver, 'resolve').resolves(mockResolution);

    const cacheGetSpy = sinon.spy(didResolver['cache'], 'get');

    // calling resolve twice
    const resolutionResult1 = await didResolver.resolve(did);
    expect(resolutionResult1).to.equal(mockResolution);
    const resolutionResult2 = await didResolver.resolve(did);
    expect(resolutionResult2).to.equal(mockResolution);

    sinon.assert.calledTwice(cacheGetSpy); // should try to fetch from cache both times
    sinon.assert.calledOnce(ionDidResolveSpy); // should only resolve using ION resolver once (the first time)
  });

  it('should throw error when invalid DID is used', async () => {
    const did = 'did:ion:invalidDid';
    const didIonResolver = new DidIonResolver();
    const didResolver = new DidResolver([didIonResolver]);

    await expect(didResolver.resolve(did)).to.be.rejectedWith(Error);
  });

  it('should throw error when unsupported DID method is used', async () => {
    const did = 'did:unsupportedDidMethod:EiClkZMDxPKqC9c-umQfTkR8vvZ9JPhl_xLDI9Nfk38w5w';
    const didIonResolver = new DidIonResolver();
    const didResolver = new DidResolver([didIonResolver]);

    await expect(didResolver.resolve(did)).to.be.rejectedWith(Error);
  });

  it('should throw error when resolution fails due to error in didResolutionMetadata', async () => {
    const did = 'did:ion:EiClkZMDxPKqC9c-umQfTkR8vvZ9JPhl_xLDI9Nfk38w5w';
    const didIonResolver = new DidIonResolver('unusedResolutionEndpoint');
    const didResolver = new DidResolver([didIonResolver]);

    const mockResolution = {
      didDocument           : 'any' as any,
      didResolutionMetadata : { error: 'some error' },
      didDocumentMetadata   : 'any' as any
    };

    const ionDidResolveSpy = sinon.stub(didIonResolver, 'resolve').resolves(mockResolution);
    const cacheGetSpy = sinon.spy(didResolver['cache'], 'get');

    await expect(didResolver.resolve(did)).to.be.rejectedWith(Error);

    sinon.assert.calledOnce(cacheGetSpy);
    sinon.assert.calledOnce(ionDidResolveSpy);

  });

  it('should throw error when resolution fails due to undefined didDocument', async () => {
    const did = 'did:ion:EiClkZMDxPKqC9c-umQfTkR8vvZ9JPhl_xLDI9Nfk38w5w';
    const didIonResolver = new DidIonResolver('unusedResolutionEndpoint');
    const didResolver = new DidResolver([didIonResolver]);

    const mockResolution = {
      didDocument           : undefined,
      didResolutionMetadata : 'any' as any,
      didDocumentMetadata   : 'any' as any
    };

    const ionDidResolveSpy = sinon.stub(didIonResolver, 'resolve').resolves(mockResolution);
    const cacheGetSpy = sinon.spy(didResolver['cache'], 'get');

    await expect(didResolver.resolve(did)).to.be.rejectedWith(Error);

    sinon.assert.calledOnce(cacheGetSpy);
    sinon.assert.calledOnce(ionDidResolveSpy);

  });

});

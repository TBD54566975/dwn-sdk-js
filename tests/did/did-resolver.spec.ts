import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { IonDidResolver } from '../../src/did/ion-did-resolver';
import { DIDResolver } from '../../src/did/did-resolver';

// extends chai to test promises
chai.use(chaiAsPromised);

describe('DIDResolver', () => {
  const resolutionEndpoint = 'https://beta.discover.did.microsoft.com/1.0/identifiers/';

  it('should pick the right DID resolver based on DID method name',  async () => {
    const did = 'did:ion:EiClkZMDxPKqC9c-umQfTkR8vvZ9JPhl_xLDI9Nfk38w5w';
    const ionDidResolver = new IonDidResolver(resolutionEndpoint);
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

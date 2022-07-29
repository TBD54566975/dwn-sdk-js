import { Config } from '../src/dwn';
import { DIDResolutionResult, DIDMethodResolver } from '../src/did/did-resolver';
import { DWN } from '../src/dwn';
import { generateCollectionWriteMessage } from './utils/message-generator';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

chai.use(chaiAsPromised);

describe('DWN', () => {
  describe('processMessage()', () => {
    it('should process CollectionsWrite message', async () => {
      const messageData = await generateCollectionWriteMessage();

      // setting up a stub method resolver
      const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
      resolveStub.withArgs(messageData.did).resolves({
        didResolutionMetadata : {},
        didDocument           : {
          id                 : messageData.did,
          verificationMethod : [{
            controller   : messageData.did,
            id           : messageData.keyId,
            type         : 'JsonWebKey2020',
            publicKeyJwk : messageData.keyPair.publicJwk
          }]
        },
        didDocumentMetadata: {}
      });
      const methodResolverStub = <DIDMethodResolver>{
        method  : () => { return messageData.didMethod; },
        resolve : resolveStub
      };

      const dwnConfig: Config = {
        DIDMethodResolvers: [methodResolverStub]
      };
      const dwn = await DWN.create(dwnConfig);

      const reply = await dwn.processMessage(messageData.message, { tenant: messageData.did });

      expect(reply.status.code).to.equal(202);
    });
  });
});


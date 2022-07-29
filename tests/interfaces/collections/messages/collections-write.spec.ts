import { CollectionsWrite } from '../../../../src/interfaces/collections/messages/collections-write';
import { CollectionsWriteSchema } from '../../../../src/interfaces/collections/types';
import { DIDResolutionResult, DIDResolver } from '../../../../src/did/did-resolver';
import { generateCollectionWriteMessage } from '../../../utils/message-generator';
import { secp256k1 } from '../../../../src/jose/algorithms/signing/secp256k1';
import { v4 as uuidv4 } from 'uuid';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

chai.use(chaiAsPromised);

describe('CollectionsWrite', () => {
  describe('create() & verifyAuth()', () => {
    it('should be able to create a valid CollectionsWrite message', async () => {
      // testing `create()` first
      const { privateJwk, publicJwk } = await secp256k1.generateKeyPair();
      const signatureInput = {
        jwkPrivate      : privateJwk,
        protectedHeader : {
          alg : privateJwk.alg as string,
          kid : 'did:example:alice#key1'
        }
      };

      const options = {
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : 123,
        nonce       : 'anyNonce',
        recordId    : uuidv4(),
        signatureInput
      };
      const collectionsWrite = await CollectionsWrite.create(options);

      const message = collectionsWrite.toObject() as CollectionsWriteSchema;

      expect(message.authorization).to.exist;
      expect(message.descriptor.dataCid).to.equal(options.dataCid);
      expect(message.descriptor.dataFormat).to.equal(options.dataFormat);
      expect(message.descriptor.dateCreated).to.equal(options.dateCreated);
      expect(message.descriptor.nonce).to.equal(options.nonce);
      expect(message.descriptor.recordId).to.equal(options.recordId);

      // setting up stub for resolution for testing `verifyAuth()`
      const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
      resolveStub.withArgs('did:example:alice').resolves({
        didResolutionMetadata : {},
        didDocument           : {
          id                 : 'did:example:alice',
          verificationMethod : [{
            controller   : 'did:example:alice',
            id           : 'did:example:alice#key1',
            type         : 'JsonWebKey2020',
            publicKeyJwk : publicJwk
          }]
        },
        didDocumentMetadata: {}
      });

      const resolverStub = sinon.createStubInstance(DIDResolver, { resolve: resolveStub });
      const { signers } = await collectionsWrite.verifyAuth(resolverStub);

      expect(signers.length).to.equal(1);
      expect(signers).to.include('did:example:alice');
    });
  });

  describe('verifyAuth', () => {
    it('should throw if verification signature check fails', async () => {
      const messageData = await generateCollectionWriteMessage();

      // setting up a stub method resolver
      const differentKeyPair = await secp256k1.generateKeyPair(); // used to return a different public key to simulate invalid signature
      const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
      resolveStub.withArgs( messageData.did).resolves({
        didResolutionMetadata : {},
        didDocument           : {
          id                 : messageData.did,
          verificationMethod : [{
            controller   : messageData.did,
            id           : messageData.keyId,
            type         : 'JsonWebKey2020',
            publicKeyJwk : differentKeyPair.publicJwk
          }]
        },
        didDocumentMetadata: {}
      });
      const didResolverStub = sinon.createStubInstance(DIDResolver, { resolve: resolveStub });

      const collectionsWrite = new CollectionsWrite(messageData.message);
      expect(collectionsWrite.verifyAuth(didResolverStub)).to.be.rejectedWith('signature verification failed for did:example:alice');
    });
  });
});


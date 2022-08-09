import { CollectionsWrite } from '../../../../src/interfaces/collections/messages/collections-write';
import { CollectionsWriteSchema } from '../../../../src/interfaces/collections/types';
import { DIDResolutionResult, DIDResolver } from '../../../../src/did/did-resolver';
import { secp256k1 } from '../../../../src/jose/algorithms/signing/secp256k1';
import { TestDataGenerator } from '../../../utils/test-data-generator';
import { v4 as uuidv4 } from 'uuid';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

chai.use(chaiAsPromised);

describe('CollectionsWrite', () => {
  describe('create() & verifyAuth()', () => {
    it('should be able to create and verify a valid CollectionsWrite message', async () => {
      // testing `create()` first
      const did = 'did:example:alice';
      const keyId = `${did}#key1`;
      const { privateJwk, publicJwk } = await secp256k1.generateKeyPair();
      const signatureInput = {
        jwkPrivate      : privateJwk,
        protectedHeader : {
          alg : privateJwk.alg as string,
          kid : keyId
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
      const didResolutionResult = TestDataGenerator.createDidResolutionResult(did, keyId, publicJwk);
      const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
      resolveStub.withArgs(did).resolves(didResolutionResult);

      const resolverStub = sinon.createStubInstance(DIDResolver, { resolve: resolveStub });
      const { signers } = await collectionsWrite.verifyAuth(resolverStub);

      expect(signers.length).to.equal(1);
      expect(signers).to.include(did);
    });
  });

  describe('verifyAuth', () => {
    it('should throw if verification signature check fails', async () => {
      const messageData = await TestDataGenerator.generateCollectionWriteMessage();
      const { requesterDid, requesterKeyId } = messageData;

      // setting up a stub method resolver
      const differentKeyPair = await secp256k1.generateKeyPair(); // used to return a different public key to simulate invalid signature
      const didResolutionResult = TestDataGenerator.createDidResolutionResult(requesterDid, requesterKeyId, differentKeyPair.publicJwk);
      const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
      resolveStub.withArgs( requesterDid).resolves(didResolutionResult);
      const didResolverStub = sinon.createStubInstance(DIDResolver, { resolve: resolveStub });

      const collectionsWrite = new CollectionsWrite(messageData.message);
      expect(collectionsWrite.verifyAuth(didResolverStub)).to.be.rejectedWith('signature verification failed for did:example:alice');
    });
  });
});


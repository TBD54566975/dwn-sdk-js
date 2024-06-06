import type { DerivedPrivateJwk, PermissionScope, RecordsWriteDescriptor } from '../../src/index.js';

import { expect } from 'chai';

import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { ed25519 } from '../../src/jose/algorithms/signing/ed25519.js';
import { RecordsWrite } from '../../src/interfaces/records-write.js';
import { DwnInterfaceName, DwnMethodName, Jws, KeyDerivationScheme, PermissionsProtocol, Records, TestDataGenerator, Time } from '../../src/index.js';

describe('Records', () => {
  describe('deriveLeafPrivateKey()', () => {
    it('should throw if given private key is not supported', async () => {
      const derivedKey: DerivedPrivateJwk = {
        rootKeyId         : 'unused',
        derivationScheme  : KeyDerivationScheme.ProtocolPath,
        derivedPrivateKey : (await ed25519.generateKeyPair()).privateJwk
      };
      await expect(Records.derivePrivateKey(derivedKey, ['a'])).to.be.rejectedWith(DwnErrorCode.RecordsDerivePrivateKeyUnSupportedCurve);
    });
  });

  describe('getAuthor()', () => {
    it('should return the author of RecordsWrite, RecordsDelete types', async () => {
      const bob = await TestDataGenerator.generatePersona();

      // create a record message
      const { message: recordsWriteMessage } = await TestDataGenerator.generateRecordsWrite({ author: bob });
      const recordsWriteAuthor = Records.getAuthor(recordsWriteMessage);
      expect(recordsWriteAuthor).to.equal(bob.did);

      // create a delete message
      const { message: recordsDeleteMessage } = await TestDataGenerator.generateRecordsDelete({ author: bob });
      const recordsDeleteAuthor = Records.getAuthor(recordsDeleteMessage);
      expect(recordsDeleteAuthor).to.equal(bob.did);
    });

    it('should get the author of a delegated message', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const deviceX = await TestDataGenerator.generatePersona();

      // create a delegation scope from alice to deviceX for writing records with for a protocol
      const scope:PermissionScope = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write,
        protocol  : 'https://example.com/protocol/test',
      };

      // create the delegated grant message
      const bobGrant = await PermissionsProtocol.createGrant({
        delegated   : true,
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        grantedTo   : deviceX.did,
        scope       : scope,
        signer      : Jws.createSigner(alice)
      });

      // create a record message using the grant
      const writeData = TestDataGenerator.randomBytes(32);

      const { message } = await RecordsWrite.create({
        signer         : Jws.createSigner(deviceX),
        delegatedGrant : bobGrant.dataEncodedMessage,
        protocol       : 'https://example.com/protocol/test',
        protocolPath   : 'test/path',
        dataFormat     : 'application/json',
        data           : writeData,
      });

      // expect message author to be alice
      const author = Records.getAuthor(message);
      expect(author).to.equal(alice.did);
    });
  });

  describe('constructKeyDerivationPathUsingProtocolPathScheme()', () => {
    it('should throw if given a flat-space descriptor', async () => {
      const descriptor: RecordsWriteDescriptor = {
        interface        : DwnInterfaceName.Records,
        method           : DwnMethodName.Write,
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z',
      };

      expect(() => Records.constructKeyDerivationPathUsingProtocolPathScheme(descriptor))
        .to.throw(DwnErrorCode.RecordsProtocolPathDerivationSchemeMissingProtocol);
    });
  });

  describe('constructKeyDerivationPathUsingProtocolContextScheme()', () => {
    it('should throw if not given contextId', async () => {
      expect(() => Records.constructKeyDerivationPathUsingProtocolContextScheme(undefined))
        .to.throw(DwnErrorCode.RecordsProtocolContextDerivationSchemeMissingContextId);
    });
  });

  describe('constructKeyDerivationPathUsingSchemasScheme()', () => {
    it('should throw if not given schema', async () => {
      expect(() => Records.constructKeyDerivationPathUsingSchemasScheme(undefined))
        .to.throw(DwnErrorCode.RecordsSchemasDerivationSchemeMissingSchema);
    });
  });
});

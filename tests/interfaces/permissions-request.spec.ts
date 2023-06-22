import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { expect } from 'chai';
import { PermissionsRequest } from '../../src/interfaces/permissions-request.js';
import { Secp256k1 } from '../../src/utils/secp256k1.js';
import { DwnInterfaceName, DwnMethodName } from '../../src/index.js';

chai.use(chaiAsPromised);

describe('PermissionsRequest', () => {
  describe('create', () => {
    it('creates a PermissionsRequest message', async () => {
      const { privateJwk } = await Secp256k1.generateKeyPair();
      const authorizationSignatureInput = {
        privateJwk,
        protectedHeader: {
          alg : privateJwk.alg as string,
          kid : 'did:jank:bob'
        }
      };

      const { message } = await PermissionsRequest.create({
        description : 'drugs',
        grantedBy   : 'did:jank:bob',
        grantedTo   : 'did:jank:alice',
        grantedFor  : 'did:jank:bob',
        scope       : { interface: DwnInterfaceName.Records, method: DwnMethodName.Write },
        authorizationSignatureInput
      });

      expect(message.descriptor.grantedTo).to.equal('did:jank:alice');
      expect(message.descriptor.grantedBy).to.equal('did:jank:bob');
      expect(message.descriptor.scope).to.eql({ interface: DwnInterfaceName.Records, method: DwnMethodName.Write });
      expect(message.descriptor.conditions).to.be.undefined;
      expect(message.descriptor.description).to.eql('drugs');
    });
  });
});


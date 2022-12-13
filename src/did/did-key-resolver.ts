import type { DidDocument, DidMethodResolver, DidResolutionResult } from './did-resolver.js';

import varint from 'varint';

import { base58btc } from 'multiformats/bases/base58';
import { Did } from './did.js';
import { ed25519 } from '../../src/jose/algorithms/signing/ed25519.js';
import { Encoder } from '../utils/encoder.js';
import { secp256k1 } from '../jose/algorithms/signing/secp256k1.js';
import { PrivateJwk, PublicJwk } from '../jose/types.js';

/**
 * did:key Resolver.
 * * **NOTE**: Key support is limited to Ed25519 and SECP256k1.
 * * **NOTE**: `verificationMethod` support is limited to `JsonWebKey2020`
 *
 * Helpful Resources:
 * * [DID-Key Draft Spec](https://w3c-ccg.github.io/did-method-key/)
 */
export class DidKeyResolver implements DidMethodResolver {
  method(): string {
    return 'key';
  }

  /**
   * Gets the number of bytes of the multicodec header in the `did:key` DID.
   * @param did - A `did:key` DID
   * @returns size of the multicodec head in number of bytes
   */
  public static getMulticodecSize(did: Uint8Array): number {
    let multicodecHeaderSize = 0;

    while (true) {
      const currentByte = did[multicodecHeaderSize];
      multicodecHeaderSize++;

      // bitwise and with binary 1000 0000
      // as soon as the result byte does not lead with a leading 1, we've reached the end of the multicodec header
      if ((currentByte & 0x80) !== 0x80) {
        break;
      }
    }

    return multicodecHeaderSize;
  }

  async resolve(did): Promise<DidResolutionResult> {
    const [_scheme, _method, id] = did.split(':', 3);

    try {
      const idBytes = base58btc.decode(id);
      const multicodec = varint.decode(idBytes);
      const multicodecSize = DidKeyResolver.getMulticodecSize(idBytes);
      const publicKeyBytes = idBytes.slice(multicodecSize);

      // key specific values
      const keySpecificContext = [];
      let publicJwk: PublicJwk;
      if (multicodec === 0xed) {
        // ed25519-pub multicodec
        keySpecificContext.push('https://w3id.org/security/suites/ed25519-2020/v1');
        publicJwk = await ed25519.publicKeyToJwk(publicKeyBytes);
      } else if (multicodec === 0xe7) {
        // secp256k1-pub multicodec
        publicJwk = await secp256k1.publicKeyToJwk(publicKeyBytes);
      } else {
        throw Error(`key type of multicodec ${multicodec} is not supported`);
      }

      const keyId = `${did}#${id}`;

      const didDocument: DidDocument = {
        '@context': [
          'https://www.w3.org/ns/did/v1',
          'https://w3id.org/security/suites/jws-2020/v1',
          ...keySpecificContext
        ],
        'id'                 : did,
        'verificationMethod' : [{
          id           : keyId,
          type         : 'JsonWebKey2020',
          controller   : did,
          publicKeyJwk : publicJwk
        }],
        'authentication'       : [keyId],
        'assertionMethod'      : [keyId],
        'capabilityDelegation' : [keyId],
        'capabilityInvocation' : [keyId]
      };

      return {
        '@context'            : 'https://w3id.org/did-resolution/v1',
        didDocument,
        didDocumentMetadata   : {},
        didResolutionMetadata : {}
      };
    } catch {
      return {
        didDocument           : null,
        didDocumentMetadata   : {},
        didResolutionMetadata : {
          error: 'invalidDid'
        },
      };
    }
  }

  /**
   * generates a new ed25519 public/private key pair. Creates a DID using the private key
   * @returns did, public key, private key
   */
  public static async generate(): Promise<{
    did: string,
    keyId: string,
    keyPair: { publicJwk: PublicJwk, privateJwk: PrivateJwk }
  }> {
    const { publicJwk, privateJwk } = await ed25519.generateKeyPair();

    // multicodec code for Ed25519 public keys
    const ed25519Multicodec = varint.encode(0xed);
    const publicKeyBytes = Encoder.base64UrlToBytes(publicJwk.x);
    const idBytes = new Uint8Array(ed25519Multicodec.length + publicKeyBytes.byteLength);
    idBytes.set(ed25519Multicodec, 0);
    idBytes.set(publicKeyBytes, ed25519Multicodec.length);

    const id = base58btc.encode(idBytes);
    const did = `did:key:${id}`;
    const keyId = DidKeyResolver.getKeyId(did);

    return { did, keyId, keyPair: { publicJwk, privateJwk } };
  }

  /**
   * Gets the fully qualified key ID of a `did:key` DID. ie. '<did>#<method-specific-id>'
   */
  public static getKeyId(did: string): string {
    const methodSpecificId = Did.getMethodSpecificId(did);
    const keyId = `${did}#${methodSpecificId}`;
    return keyId;
  };
}
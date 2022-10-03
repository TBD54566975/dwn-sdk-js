import * as ed25519 from '@noble/ed25519';
import * as varint from 'varint';

import { base58btc } from 'multiformats/bases/base58';
import { base64url } from 'multiformats/bases/base64';

import type { DIDMethodResolver, DIDResolutionResult, DIDDocument } from './did-resolver';
import { PrivateJwk, PublicJwk } from '../jose/types';


// multicodec code for Ed25519 keys
const ED25519_CODEC_ID = varint.encode(parseInt('0xed', 16));

/**
 * did:key Resolver.
 * * **NOTE**: Key support is limited to Ed25519.
 * * **NOTE**: `verificationMethod` support is limited to `JsonWebKey2020`
 *
 * Helpful Resources:
 * * [DID-Key Draft Spec](https://w3c-ccg.github.io/did-method-key/)
 */
export class DIDKeyResolver implements DIDMethodResolver {
  method(): string {
    return 'key';
  }

  async resolve(did): Promise<DIDResolutionResult> {
    const [_scheme, _method, id] = did.split(':');

    try {
      const idBytes = base58btc.decode(id);
      const publicKeyBytes = idBytes.slice(ED25519_CODEC_ID.length);

      const publicJwk = {
        alg : 'EdDSA',
        crv : 'Ed25519',
        kty : 'OKP',
        use : 'sig',
        x   : base64url.baseEncode(publicKeyBytes)
      };

      const keyId = `${did}#${id}`;

      const didDocument: DIDDocument = {
        '@context': [
          'https://www.w3.org/ns/did/v1',
          'https://w3id.org/security/suites/ed25519-2020/v1',
          'https://w3id.org/security/suites/jws-2020/v1'
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
    } catch (e) {
      // TODO: log error?
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
   * generates a new ed25519 public/private keypair. Creates a DID using the private key
   * @return {GenerateDIDResult} did, public key, private key
   */
  async generate(): Promise<{ did: string, publicJwk: PublicJwk, privateJwk: PrivateJwk }> {
    const privateKeyBytes = ed25519.utils.randomPrivateKey();
    const publicKeyBytes = await ed25519.getPublicKey(privateKeyBytes);

    const idBytes = new Uint8Array(publicKeyBytes.byteLength + ED25519_CODEC_ID.length);
    idBytes.set(ED25519_CODEC_ID, 0);
    idBytes.set(publicKeyBytes, ED25519_CODEC_ID.length);

    const id = base58btc.encode(idBytes);
    const did = `did:key:${id}`;

    const publicJwk = {
      alg : 'EdDSA',
      crv : 'Ed25519',
      kty : 'OKP',
      use : 'sig',
      x   : base64url.baseEncode(publicKeyBytes)
    };

    const privateJwk = { ...publicJwk, d: base64url.baseEncode(privateKeyBytes) };

    return { did, publicJwk, privateJwk };
  }
}
import type { GeneralJws, Signature } from './types';
import type { PublicJwk } from '../../types';
import type { VerificationMethod } from '../../../did/did-resolver';

import { base64url } from 'multiformats/bases/base64';
import { DIDResolver } from '../../../did/did-resolver';
import { signers as verifiers } from '../../algorithms';

type VerificationResult = {
  /** DIDs of all signers */
  signers: string[];
};

// TODO: add logic to prevent validating duplicate signatures
export class GeneralJwsVerifier {
  jws: GeneralJws;

  constructor(jws: GeneralJws) {
    this.jws = jws;
  }

  async verify(didResolver: DIDResolver): Promise<VerificationResult> {
    const signers: string[] = [];

    for (const signature of this.jws.signatures) {
      const protectedBytes = base64url.baseDecode(signature.protected);
      const protectedJson = new TextDecoder().decode(protectedBytes);

      const { kid } = JSON.parse(protectedJson);
      const did = GeneralJwsVerifier.extractDid(kid);
      const publicJwk = await GeneralJwsVerifier.getPublicKey(did, kid, didResolver);

      const isVerified = await GeneralJwsVerifier.verifySignature(this.jws.payload, signature, publicJwk);

      if (isVerified) {
        signers.push(did);
      } else {
        throw new Error(`signature verification failed for ${did}`);
      }
    }

    return { signers };
  }

  static async getPublicKey(did: string, kid: string, didResolver: DIDResolver): Promise<PublicJwk> {
    // `resolve` throws exception if DID is invalid, DID method is not supported,
    // or resolving DID fails

    const { didDocument } = await didResolver.resolve(did);
    const { verificationMethod: verificationMethods = [] } = didDocument || {};

    let verificationMethod: VerificationMethod | undefined;

    for (const vm of verificationMethods) {
      // consider optimizing using a set for O(1) lookups if needed
      if (vm.id === kid) {
        verificationMethod = vm;
        break;
      }
    }


    if (!verificationMethod) {
      throw new Error('public key needed to verify signature not found in DID Document');
    }

    // TODO: replace with JSON Schema based validation
    // more info about the `JsonWebKey2020` type can be found here:
    // https://www.w3.org/TR/did-spec-registries/#jsonwebkey2020
    if (verificationMethod.type !== 'JsonWebKey2020') {
      throw new Error(`verification method [${kid}] must be JsonWebKey2020`);
    }

    const { publicKeyJwk: publicJwk } = verificationMethod;

    // TODO: replace with JSON Schema based validation
    // more info about the `publicJwk` property can be found here:
    // https://www.w3.org/TR/did-spec-registries/#publicJwk
    if (!publicJwk) {
      throw new Error(`publicKeyJwk property not found on verification method [${kid}]`);
    }

    return publicJwk as PublicJwk;
  }

  static async verifySignature(base64UrlPayload: string, signature: Signature, jwkPublic: PublicJwk): Promise<boolean> {
    const verifier = verifiers[jwkPublic.crv];

    if (!verifier) {
      throw new Error(`unsupported crv. crv must be one of ${Object.keys(verifiers)}`);
    }

    const payload = new TextEncoder().encode(`${signature.protected}.${base64UrlPayload}`);
    const signatureBytes = base64url.baseDecode(signature.signature);

    return await verifier.verify(payload, signatureBytes, jwkPublic);
  }

  decodePayload(): Uint8Array {
    return base64url.baseDecode(this.jws.payload);
  }

  private static extractDid(kid: string): string {
    const [ did ] = kid.split('#');
    return did;
  }
}
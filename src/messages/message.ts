import type { JsonMessage } from './types';
import type { GeneralJws } from '../jose/types';

import * as jws from '../jose/jws';

import { base64url } from 'multiformats/bases/base64';
import { DIDResolver, VerificationMethod } from '../did/did-resolver';

type payloadFieldOpts = {
  required: Set<string>,
  optional: Set<string>
};

export abstract class Message<T extends JsonMessage> {
  constructor(protected message: T) {}

  toObject(): T {
    return this.message;
  }

  toJSON(): string {
    return JSON.stringify(this.message);
  }

  async verifyAuth(didResolver: DIDResolver, payloadReq: payloadFieldOpts) {
    const authorization: GeneralJws = this.message.authorization;

    if (!authorization) {
      return;
    }

    const payloadBytes = base64url.decode(authorization.payload);
    const payloadStr = new TextDecoder().decode(payloadBytes);
    const payloadJson = JSON.parse(payloadStr);

    for (let propertyName of Object.keys(payloadJson)) {
      if (!payloadReq.required.has(propertyName) && !payloadReq.optional.has(propertyName)) {
        throw new Error(`${propertyName} shouldn't be present in auth payload`);
      }
    }

    for (let signature of authorization.signatures) {
      const protectedBytes = base64url.baseDecode(signature.protected);
      const protectedJson = new TextDecoder().decode(protectedBytes);

      const { kid } = JSON.parse(protectedJson);
      const [ did ] = kid.split('#');

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

      const { publicKeyJwk } = verificationMethod;

      // TODO: replace with JSON Schema based validation
      // more info about the `publicKeyJwk` property can be found here:
      // https://www.w3.org/TR/did-spec-registries/#publickeyjwk
      if (!publicKeyJwk) {
        throw new Error(`publicKeyJwk property not found on verification method [${kid}]`);
      }

      // TODO: figure out if we need to check to ensure that `controller` === did in kid
      //       are the same. This may matter more for a `PermissionsRequest`


      const result = await jws.verify(authorization.payload, signature, publicKeyJwk);

      if (!result) {
        throw new Error('signature verification failed');
      }
    }
  }
}
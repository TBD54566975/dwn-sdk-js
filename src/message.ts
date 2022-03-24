/**
 * this file contains functions and types related to messages
 */
import type { PermissionsRequestMessage, PermissionsMethod } from './interfaces/permissions';

import Ajv from 'ajv';
import * as cbor from '@ipld/dag-cbor';

import { base64url } from 'multiformats/bases/base64';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';

import permissionsSchemas from './interfaces/permissions/schemas';

// a map of all supported CID hashing algorithms. This map is used to select the appropriate hasher
// when generating a CID to compare against a provided CID
const HASHERS = {
  [sha256.code]: sha256
};

// `allErrors` checks all rules and collects all errors vs. short-circuiting
// on the first error.
const validator = new Ajv({ allErrors: true });

for (let schemaName in permissionsSchemas) {
  validator.addSchema(permissionsSchemas[schemaName], schemaName);
}

/**
 * TODO: add docs
 * @param message - the message to validate
 */
export function validateMessage(message: Message) {
  // all interface methods have slightly different message requirements. validate message based
  // on method
  const { method: methodName } = message.descriptor;

  const validateFn = validator.getSchema(methodName);

  if (!validateFn) {
    throw new Error('{methodName} is not a supported method.');
  }

  const isValid = validateFn(message);

  if (!isValid) {
    // TODO: build helpful errors object using returned errors
    // Every time a validation function is called the errors property is overwritten.
    // const errors = [...validateFn.errors];
    throw new Error('Invalid message.');
  }
}

/**
 * verifies the signature of the provided message. Details regarding message signing can be found
 * {@link https://identity.foundation/identity-hub/spec/#signed-data here}.
 * @param message - the message to verify
 */
export async function verifyMessageSignature(message: Message) {
  const { descriptor, attestation } = message;
  let providedCID: CID;

  // check to ensure that attestation payload is a valid CID
  try {
    // `baseDecode` throws SyntaxError: Unexpected end of data if paylod is not base64
    const payloadBytes = base64url.baseDecode(attestation.payload);

    // `decode` throws `Error` if the bytes provided do not contain a valid binary representation
    //  of a CID.
    providedCID = CID.decode(payloadBytes).toV1();
  } catch (e) {
    throw new Error('payload is not a valid CID');
  }

  if (providedCID.code !== cbor.code) {
    throw new Error('CID of descriptor must be CBOR encoded');
  }

  // create CID of descriptor to check against provided CID
  const cborBytes = cbor.encode(descriptor);
  const hasher = HASHERS[providedCID.multihash.code];

  if (!hasher) {
    throw new Error(`multihash code [${providedCID.multihash.code}] not supported`);
  }

  const cborHash = await hasher.digest(cborBytes);
  const expectedCID = await CID.createV1(cbor.code, cborHash);

  if (!expectedCID.equals(providedCID)) {
    throw new Error('provided CID does not match expected CID of descriptor');
  }
}

export type Message = PermissionsRequestMessage;
export type Method = PermissionsMethod;
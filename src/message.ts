/**
 * this file contains functions and types related to messages
 */
import type { PermissionsMethod, PermissionsRequestMessage } from './interfaces/permissions';

import * as cbor from '@ipld/dag-cbor';
import Ajv from 'ajv';
import Jws from './crypto/Jws';
import permissionsSchemas from './interfaces/permissions/schemas';

import { base64url } from 'multiformats/bases/base64';
import { CID } from 'multiformats/cid';
import { DIDResolver } from './did/did-resolver';
import { sha256 } from 'multiformats/hashes/sha2';


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
 * {@link https://identity.foundation/decentralized-web-node/spec/#signed-data here}.
 * @param message - the message to verify
 * @throws {Error} if provided CID is invalid
 * @throws {Error} if provided CID doesn't utilize CBOR codec
 * @throws {Error} if provided CID was created using unsupporting hashing algo
 * @throws {Error} if resolving DID Doc failed
 * @throws {Error} if respective public key could not be found in DID Doc
 * @throws {Error} if signature verification failed with public key
 */
export async function verifyMessageSignature(message: Message, didResolver: DIDResolver) {
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

  // we need the public key of the signer so that we can verify the signature. steps:
  //  - decode `attestation.protected` so that we can grab `kid`. That's where the signer's DID is
  //  - resolve signer's DID
  //  - grab appropriate public key from DID doc by `kid`
  //  - use public key to verify signature

  // `baseDecode` throws SyntaxError: Unexpected end of data if paylod is not base64
  const protectedBytes = base64url.baseDecode(attestation.protected);
  const protectedJson = Buffer.from(protectedBytes).toString();

  const { alg, kid } = JSON.parse(protectedJson);
  const [ did ] = kid.split('#');

  // `resolve` throws exception if DID is invalid, DID method is not supported,
  // or resolving DID fails
  const { didDocument } = await didResolver.resolve(did);
  const { verificationMethod: verificationMethods = [] } = didDocument;

  // use a set to do O(1) "lookups" for the correct id
  const verificationMethodIds = new Set();
  let publicKey;

  for (let verificationMethod of verificationMethods) {
    verificationMethodIds.add(verificationMethod.id);

    // TODO: figure out if we need to support ALL verification method properties
    //       listed here: https://www.w3.org/TR/did-spec-registries/#verification-method-properties

    // TODO: figure out if we need to support ALL verification method types
    //       listed here: https://www.w3.org/TR/did-spec-registries/#verification-method-types

    // TODO: figure out if we need to check to ensure that `controller` === did in kid
    //       are the same. This may matter more for a `PermissionsRequest`

    // going to naively yank `publicKeyJwk` for now until above TODOS are resolved. thxbai
    if (verificationMethodIds.has(kid)) {
      publicKey = verificationMethod.publicKeyJwk;
      break;
    }
  }

  if (!publicKey) {
    throw new Error('failed to find respective public key to verify signature');
  }

  const result = await Jws.verify(attestation, publicKey);

  if (!result) {
    throw new Error('signature verification failed');
  }
}

export type Message = PermissionsRequestMessage;
export type Method = PermissionsMethod;
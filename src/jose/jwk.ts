import * as ed25519 from './algorithms/ed25519';
import * as secp256k1 from './algorithms/secp256k1';
import Ajv from 'ajv';
import type { JwkEd25519Private, JwkEd25519Public } from './algorithms/ed25519';
import type { JwkSecp256k1Private, JwkSecp256k1Public } from './algorithms/secp256k1';

/**
 * A supported private key in JWK format.
 */
export type JwkPrivate = JwkSecp256k1Private | JwkEd25519Private;

/**
 * A supported public key in JWK format.
 */
export type JwkPublic = JwkSecp256k1Public | JwkEd25519Public;

const jwkPublicSchema = {
  anyOf: [
    ed25519.jwkPublicJsonSchema,
    secp256k1.jwkPublicJsonSchema
  ]
};

const jwkPrivateSchema = {
  anyOf: [
    ed25519.jwkPrivateJsonSchema,
    secp256k1.jwkPrivateJsonSchema
  ]
};

const ajv = new Ajv();
const validateJwkPublicInternal = ajv.compile<JwkPublic>(jwkPublicSchema);
const validateJwkPrivateInternal = ajv.compile<JwkPrivate>(jwkPrivateSchema);

export function validateJwkPrivate (jwkPrivate: any) {
  const isValid = validateJwkPrivateInternal(jwkPrivate);
  if (!isValid) {
    throw new Error(`invalid or unsupported JWK private key: ${JSON.stringify(jwkPrivate)}`);
  }
}

export function validateJwkPublic (jwkPublic: any) {
  const isValid = validateJwkPublicInternal(jwkPublic);
  if (!isValid) {
    throw new Error(`invalid or unsupported JWK public key: ${JSON.stringify(jwkPublic)}`);
  }
}

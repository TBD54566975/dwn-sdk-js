import type JwkSecp256k1Public from './JwkSecp256k1Public';

/**
 * Model for representing a SECP256K1 private key in JWK format.
 */
type JwkSecp256k1Private = JwkSecp256k1Public & {
  d: string; // Only used by a private key.
};

export default JwkSecp256k1Private;

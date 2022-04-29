import type JwkEd25519Public from './JwkEd25519Public';

/**
 * Model for representing an Ed25519 private key in JWK format.
 */
type JwkEd25519Private = JwkEd25519Public & {
  d: string; // Only used by a private key.
};

export default JwkEd25519Private;

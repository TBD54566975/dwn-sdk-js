import type JwkEd25519Public from './JwkEd25519Public';

/**
 * Model for representing a Ed25519 private key in JWK format.
 */
export default interface JwkEd25519Private extends JwkEd25519Public {
  d: string; // Only used by a private key.
};

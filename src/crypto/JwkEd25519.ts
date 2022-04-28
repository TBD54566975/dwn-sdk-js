/**
 * Model for representing a Ed25519 key in a JWK format.
 */
type JwkEd25519 = {
  kty: string;
  crv: string;
  x: string;
  d?: string; // Only used by a private key.
};

export default JwkEd25519;

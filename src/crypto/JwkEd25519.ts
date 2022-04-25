/**
 * Model for representing a Ed25519 key in a JWK format.
 */
export default interface JwkEd25519 {
  kty: string;
  crv: string;
  x: string;
  d?: string; // Only used by a private key.
}

/**
 * Model for representing a SECP256K1 key in a JWK format.
 */
type JwkSecp256k1 = {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d?: string; // Only used by a private key.
};

export default JwkSecp256k1;

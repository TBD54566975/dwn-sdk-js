/**
 * Model for representing an Ed25519 public key in JWK format.
 */
type JwkEd25519Public = {
  kty: string;
  crv: string;
  x: string;
};

export default JwkEd25519Public;

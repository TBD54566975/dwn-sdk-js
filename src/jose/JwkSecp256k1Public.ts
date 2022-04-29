/**
 * Model for representing a SECP256K1 public key in JWK format.
 */
type JwkSecp256k1Public = {
  kty: string;
  crv: string;
  x: string;
  y: string;
};

export default JwkSecp256k1Public;

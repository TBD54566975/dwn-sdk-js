/**
 * A SECP256K1 public key in JWK format.
 */
export type JwkSecp256k1Public = {
  kty: string;
  crv: string;
  x: string;
  y: string;
};

/**
 * A SECP256K1 private key in JWK format.
 */
export type JwkSecp256k1Private = JwkSecp256k1Public & {
  d: string; // Only used by a private key.
};

/**
 * An Ed25519 public key in JWK format.
 */
export type JwkEd25519Public = {
  kty: string;
  crv: string;
  x: string;
};

/**
 * An Ed25519 private key in JWK format.
 */
export type JwkEd25519Private = JwkEd25519Public & {
  d: string; // Only used by a private key.
};

/**
 * A supported private key in JWK format.
 */
export type JwkPrivate = JwkSecp256k1Private | JwkEd25519Private;

/**
 * A supported public key in JWK format.
 */
export type JwkPublic = JwkSecp256k1Public | JwkEd25519Public;

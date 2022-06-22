export interface Jwk {
  alg?: string;
  kid?: string;
}

/**
 * A SECP256K1 public key in JWK format.
 * Values taken from:
 * https://www.iana.org/assignments/jose/jose.xhtml#web-key-elliptic-curve
 * https://datatracker.ietf.org/doc/html/draft-ietf-cose-webauthn-algorithms-06#section-3.1
 */
export type JwkEd25519Public = Jwk & {
  alg: 'EdDSA';
  crv: 'Ed25519';
  kty: 'OKP';
  x: string;
};

/**
 * An Ed25519 private key in JWK format.
 */
export type JwkEd25519Private = JwkEd25519Public & {
  d: string; // Only used by a private key
};

export type JwkSecp256k1Public = Jwk & {
  alg: 'ES256K';
  crv: 'secp256k1';
  kty: 'EC';
  x: string;
  y: string;
};

/**
 * A SECP256K1 private key in JWK format.
 */
export type JwkSecp256k1Private = JwkSecp256k1Public & {
  d: string; // Only used by a private key.
};

export type JwkPublic = JwkSecp256k1Public | JwkEd25519Public;
export type JwkPrivate = JwkSecp256k1Private | JwkEd25519Private;
export type Jwk = {
  /** The "alg" (algorithm) parameter identifies the algorithm intended for use with the key. */
  alg?: string;
  /** The "alg" (algorithm) parameter identifies the algorithm intended for use with the key. */
  kid?: string;
  /** identifies the cryptographic algorithm family used with the key, such "EC". */
  kty: string;
};

/**
 * A SECP256K1 public key in JWK format.
 * Values taken from:
 * https://www.iana.org/assignments/jose/jose.xhtml#web-key-elliptic-curve
 * https://datatracker.ietf.org/doc/html/draft-ietf-cose-webauthn-algorithms-06#section-3.1
 */
export type PublicEd25519Jwk = Jwk & {
  alg?: 'EdDSA';
  crv: 'Ed25519';
  kty: 'OKP';
  x: string;
};

/**
 * An Ed25519 private key in JWK format.
 */
export type PrivateEd25519Jwk = PublicEd25519Jwk & {
  d: string; // Only used by a private key
};

export type PublicSecp256k1Jwk = Jwk & {
  alg?: 'ES256K';
  crv: 'secp256k1';
  kty: 'EC';
  x: string;
  y: string;
};

/**
 * A SECP256K1 private key in JWK format.
 */
export type PrivateSecp256k1Jwk = PublicSecp256k1Jwk & {
  d: string; // Only used by a private key.
};

export type PublicJwk = PublicSecp256k1Jwk | PublicEd25519Jwk;
export type PrivateJwk = PrivateSecp256k1Jwk | PrivateEd25519Jwk;

export type Signfn = (payload: Uint8Array, privateJwk: PrivateJwk) => Promise<Uint8Array>;
export type VerifyFn = (payload: Uint8Array, signature: Uint8Array, publicJwk: PublicJwk) => Promise<boolean>;
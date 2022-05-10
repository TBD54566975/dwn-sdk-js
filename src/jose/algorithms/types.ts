import type { JwkPrivate, JwkPublic } from '../jwk';

export type Signer = (payload: Uint8Array, privateKeyJwk: JwkPrivate) => Promise<Uint8Array>;
export type Verifier = (payload: Uint8Array, signature: Uint8Array, publicKeyJwk: JwkPublic) => Promise<boolean>;
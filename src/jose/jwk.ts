import type { JwkEd25519Private, JwkEd25519Public } from './algorithms/ed25519';
import type { JwkSecp256k1Private, JwkSecp256k1Public } from './algorithms/secp256k1';

export { generateKeyPair as generateEd25519Jwk } from './algorithms/ed25519';
export { generateKeyPair as generateSecp256k1Jwk } from './algorithms/secp256k1';

export type JwkPublic = JwkSecp256k1Public | JwkEd25519Public;
export type JwkPrivate = JwkSecp256k1Private | JwkEd25519Private;

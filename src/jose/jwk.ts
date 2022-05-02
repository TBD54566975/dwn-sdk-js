import type { JwkEd25519Private, JwkEd25519Public } from './ed25519';
import type { JwkSecp256k1Private, JwkSecp256k1Public } from './secp256k1';

/**
 * A supported private key in JWK format.
 */
export type JwkPrivate = JwkSecp256k1Private | JwkEd25519Private;

/**
 * A supported public key in JWK format.
 */
export type JwkPublic = JwkSecp256k1Public | JwkEd25519Public;

import type JwkEd25519Public from './JwkEd25519Public';
import type JwkSecp256k1Public from './JwkSecp256k1Public';

/**
 * A supported public key in JWK format.
 */
type JwkPublic = JwkSecp256k1Public | JwkEd25519Public;

export default JwkPublic;

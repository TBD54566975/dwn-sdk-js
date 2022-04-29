import type JwkEd25519Private from './JwkEd25519Private';
import type JwkSecp256k1Private from './JwkSecp256k1Private';

/**
 * A private key in JWK format.
 */
type JwkPrivate = JwkSecp256k1Private | JwkEd25519Private;

export default JwkPrivate;

import { ed25519 } from './ed25519';
import { secp256k1 } from './secp256k1';

// the key should be the appropriate `crv` value
export const signers = {
  'Ed25519'   : ed25519,
  'secp256k1' : secp256k1,
};
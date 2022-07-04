import { Ed25519 } from './ed25519';
import { Secp256k1 } from './secp256k1';

// the key should be the appropriate `crv` value
export const signers = {
  'Ed25519'   : Ed25519,
  'secp256k1' : Secp256k1,
};
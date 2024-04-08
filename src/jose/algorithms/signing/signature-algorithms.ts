import type { SignatureAlgorithm } from '../../../types/jose-types.js';

import { ed25519 } from './ed25519.js';
import { Secp256k1 } from '../../../utils/secp256k1.js';
import { Secp256r1 } from '../../../utils/secp256r1.js';

// the key should be the appropriate `crv` value
export const signatureAlgorithms: Record<string, SignatureAlgorithm> = {
  'Ed25519'   : ed25519,
  'secp256k1' : {
    sign            : Secp256k1.sign,
    verify          : Secp256k1.verify,
    generateKeyPair : Secp256k1.generateKeyPair,
    publicKeyToJwk  : Secp256k1.publicKeyToJwk
  },
  'P-256': {
    sign            : Secp256r1.sign,
    verify          : Secp256r1.verify,
    generateKeyPair : Secp256r1.generateKeyPair,
    publicKeyToJwk  : Secp256r1.publicKeyToJwk,
  },
};
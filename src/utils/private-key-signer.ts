import type { PrivateJwk } from '../types/jose-types.js';
import type { Signer } from '../types/signer.js';

import { signers as signatureAlgorithms } from '../jose/algorithms/signing/signers.js';
import { DwnError, DwnErrorCode } from '../index.js';

/**
 * A signer that signs using a private key.
 */
export class PrivateKeySigner implements Signer {
  private signatureAlgorithm;

  public constructor(private privateJwk: PrivateJwk) {
    this.signatureAlgorithm = signatureAlgorithms[privateJwk.crv];

    if (!this.signatureAlgorithm) {
      throw new DwnError(
        DwnErrorCode.PrivateKeySignerUnsupportedCurve,
        `Unsupported crv ${privateJwk.crv}, crv must be one of ${Object.keys(signatureAlgorithms)}`
      );
    }
  }

  /**
   * Signs the given content and returns the signature as bytes.
   */
  public async sign (content: Uint8Array): Promise<Uint8Array> {
    const signatureBytes = await this.signatureAlgorithm.sign(content, this.privateJwk);
    return signatureBytes;
  }
}

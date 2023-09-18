import type { GeneralJws } from '../../../types/jws-types.js';
import type { Signer } from '../../../types/signer.js';

import { Encoder } from '../../../utils/encoder.js';

export class GeneralJwsBuilder {
  private jws: GeneralJws;

  private constructor(jws: GeneralJws) {
    this.jws = jws;
  }

  static async create(payload: Uint8Array, signers: Signer[] = []): Promise<GeneralJwsBuilder> {
    const jws: GeneralJws = {
      payload    : Encoder.bytesToBase64Url(payload),
      signatures : []
    };

    const builder = new GeneralJwsBuilder(jws);

    for (const signer of signers) {
      await builder.addSignature(signer);
    }

    return builder;
  }

  async addSignature(signer: Signer): Promise<void> {
    const protectedHeader = {
      kid : signer.keyId,
      alg : signer.algorithm
    };
    const protectedHeaderString = JSON.stringify(protectedHeader);
    const protectedHeaderBase64UrlString = Encoder.stringToBase64Url(protectedHeaderString);

    const signingInputString = `${protectedHeaderBase64UrlString}.${this.jws.payload}`;
    const signingInputBytes = Encoder.stringToBytes(signingInputString);

    const signatureBytes = await signer.sign(signingInputBytes);
    const signature = Encoder.bytesToBase64Url(signatureBytes);

    this.jws.signatures.push({ protected: protectedHeaderBase64UrlString, signature });
  }

  getJws(): GeneralJws {
    return this.jws;
  }
}
import type { GeneralJws, SignatureInput } from '../../../types/jws-types.js';

import { Encoder } from '../../../utils/encoder.js';

export class GeneralJwsBuilder {
  private jws: GeneralJws;

  private constructor(jws: GeneralJws) {
    this.jws = jws;
  }

  static async create(payload: Uint8Array, signatureInputs: SignatureInput[] = []): Promise<GeneralJwsBuilder> {
    const jws: GeneralJws = {
      payload    : Encoder.bytesToBase64Url(payload),
      signatures : []
    };

    const builder = new GeneralJwsBuilder(jws);

    for (const signatureInput of signatureInputs) {
      await builder.addSignature(signatureInput);
    }

    return builder;
  }

  async addSignature(signatureInput: SignatureInput): Promise<void> {
    const { signer, protectedHeader } = signatureInput;

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
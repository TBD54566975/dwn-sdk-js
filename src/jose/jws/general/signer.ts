import type { GeneralJws, SignatureInput } from './types.js';

import { Encoder } from '../../../utils/encoder.js';
import { signers } from '../../algorithms/index.js';

export class GeneralJwsSigner {
  private jws: GeneralJws;

  constructor(jws: GeneralJws) {
    this.jws = jws;
  }

  static async create(payload: Uint8Array, signatureInputs: SignatureInput[] = []): Promise<GeneralJwsSigner> {
    const jws: GeneralJws = {
      payload    : Encoder.bytesToBase64Url(payload),
      signatures : []
    };

    const signer = new GeneralJwsSigner(jws);

    for (const signatureInput of signatureInputs) {
      await signer.addSignature(signatureInput);
    }

    return signer;
  }

  async addSignature(signatureInput: SignatureInput): Promise<void> {
    const { jwkPrivate, protectedHeader } = signatureInput;
    const signer = signers[jwkPrivate.crv];

    if (!signer) {
      throw new Error(`unsupported crv. crv must be one of ${Object.keys(signers)}`);
    }

    const protectedHeaderString = JSON.stringify(protectedHeader);
    const protectedHeaderBase64UrlString = Encoder.stringToBase64Url(protectedHeaderString);

    const signingInputString = `${protectedHeaderBase64UrlString}.${this.jws.payload}`;
    const signingInputBytes = Encoder.stringToBytes(signingInputString);

    const signatureBytes = await signer.sign(signingInputBytes, jwkPrivate);
    const signature = Encoder.bytesToBase64Url(signatureBytes);

    this.jws.signatures.push({ protected: protectedHeaderBase64UrlString, signature });
  }

  getJws(): GeneralJws {
    return this.jws;
  }
}
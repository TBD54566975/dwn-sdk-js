import * as ed from '@noble/ed25519';
import base64url from 'base64url';
import JwsFlattenedModel from './JwsFlattenedModel';

/**
 * Class containing reusable JWS operations.
 */
export default class Jws {
  /**
   * Verifies the JWS signature.
   * @returns true if signature is successfully verified, false otherwise.
   */
  public static async verifySignature (
    jwsFlattenedModel: JwsFlattenedModel,
    publicKey: object
  ): Promise<boolean> {
    const publicKeyBuffer = base64url.toBuffer((publicKey as any).x);
    const signatureInput = jwsFlattenedModel.protected + '.' + jwsFlattenedModel.payload;
    const signatureInputBuffer = Buffer.from(signatureInput);
    const signatureBuffer = base64url.toBuffer(jwsFlattenedModel.signature);
    const result = await ed.verify(signatureBuffer, signatureInputBuffer, publicKeyBuffer);
    return result;
  }

  /**
   * Signs the given protected header and payload as a JWS.
   * NOTE: this is mainly used by tests to create valid test data.
   *
   * @param payload If the given payload is of string type, it is assumed to be encoded string;
   *                else the object will be stringified and encoded.
   */
  public static async sign (
    protectedHeader: object,
    payload: Buffer,
    privateKeyJwk: object
  ): Promise<JwsFlattenedModel> {

    // keys, messages & other inputs can be Uint8Arrays or hex strings
    const protectedHeaderString = JSON.stringify(protectedHeader);
    const protectedHeaderBase64UrlString = base64url.encode(protectedHeaderString);
    const payloadBase64UrlString = base64url.encode(payload);
    const signingInputBase64urlString = protectedHeaderBase64UrlString + '.' + payloadBase64UrlString;
    const signingInputBuffer = Buffer.from(signingInputBase64urlString);
    const privateKeyBuffer = base64url.toBuffer((privateKeyJwk as any).d);
    const signatureUint8Array = await ed.sign(signingInputBuffer, privateKeyBuffer);
    const signatureBuffer = Buffer.from(signatureUint8Array);
    const signatureBase64UrlString = base64url.encode(signatureBuffer);

    return {
        payload: payloadBase64UrlString,
        protected: protectedHeaderBase64UrlString,
        signature: signatureBase64UrlString
    }
  }

//   /**
//    * Signs the given payload as a compact JWS string.
//    * This is mainly used by tests to create valid test data.
//    */
//   public static signAsCompactJws (payload: object, privateKey: any, protectedHeader?: object): string {
//     const compactJws = JWS.sign(payload, privateKey, protectedHeader);
//     return compactJws;
//   }

//   /**
//    * Parses the input as a `Jws` object.
//    */
//   public static parseCompactJws (compactJws: any): Jws {
//     return new Jws(compactJws);
//   }

  /**
   * Creates a compact JWS string using the given input. No string validation is performed.
   */
  public static createCompactJws (protectedHeader: string, payload: string, signature: string): string {
    return protectedHeader + '.' + payload + '.' + signature;
  }
}

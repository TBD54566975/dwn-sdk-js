import * as ed25519 from '@noble/ed25519';
import base64url from 'base64url';
import JwkEd25519 from './JwkEd25519';
import JwsFlattenedModel from './JwsFlattenedModel';

/**
 * Class containing reusable JWS operations.
 */
export default class Jws {
  /**
   * Signs the given payload as a JWS.
   * NOTE: this is mainly used by tests to create valid test data.
   * @throws {Error} if key given is unsupported.
   */
  public static async sign (
    protectedHeader: object,
    payload: Buffer,
    privateKeyJwk: any
  ): Promise<JwsFlattenedModel> {

    const protectedHeaderString = JSON.stringify(protectedHeader);
    const protectedHeaderBase64UrlString = base64url.encode(protectedHeaderString);
    const payloadBase64UrlString = base64url.encode(payload);
    const signingInputBase64urlString = protectedHeaderBase64UrlString + '.' + payloadBase64UrlString;
    const signingInputBuffer = Buffer.from(signingInputBase64urlString);

    // This is where we will add support for different algorithms over time.
    let signatureBuffer;
    if (privateKeyJwk.crv === 'Ed25519') {
      signatureBuffer = await Jws.signEd25519(signingInputBuffer, privateKeyJwk as Required<JwkEd25519>);
    } else {
      throw new Error(`unsupported key type ${privateKeyJwk.kty} with curve ${privateKeyJwk.crv}`);
    }

    const signatureBase64UrlString = base64url.encode(signatureBuffer);

    return {
      payload   : payloadBase64UrlString,
      protected : protectedHeaderBase64UrlString,
      signature : signatureBase64UrlString
    };
  }

  /**
   * Implementation of signing using ED25519.
   */
  private static async signEd25519 (
    signingInputBuffer: Buffer,
    privateKeyJwk: Required<JwkEd25519>
  ): Promise<Buffer> {
    const privateKeyBuffer = base64url.toBuffer(privateKeyJwk.d);
    const signatureUint8Array = await ed25519.sign(signingInputBuffer, privateKeyBuffer);
    const signatureBuffer = Buffer.from(signatureUint8Array);
    return signatureBuffer;
  }

  /**
   * Verifies the JWS signature.
   * @returns `true` if signature is successfully verified, false otherwise.
   * @throws {Error} if key given is unsupported.
   */
  public static async verify (
    jwsFlattenedModel: JwsFlattenedModel,
    publicKeyJwk: any
  ): Promise<boolean> {
    const signatureInput = jwsFlattenedModel.protected + '.' + jwsFlattenedModel.payload;
    const signatureInputBuffer = Buffer.from(signatureInput);
    const signatureBuffer = base64url.toBuffer(jwsFlattenedModel.signature);

    // This is where we will add support for different algorithms over time.
    let result = false;
    if (publicKeyJwk.crv === 'Ed25519') {
      result = await Jws.verifyEd25519(signatureInputBuffer, signatureBuffer, publicKeyJwk as JwkEd25519);
    } else {
      throw new Error(`unsupported key type ${publicKeyJwk.kty} with curve ${publicKeyJwk.crv}`);
    }

    return result;
  }

  /**
   * Implementation of signature verification using ED25519.
   */
  private static async verifyEd25519 (
    signatureInputBuffer: Buffer,
    signatureBuffer: Buffer,
    publicKeyJwk: JwkEd25519
  ): Promise<boolean> {
    const publicKeyBuffer = base64url.toBuffer(publicKeyJwk.x);
    const result = await ed25519.verify(signatureBuffer, signatureInputBuffer, publicKeyBuffer);
    return result;
  }
}

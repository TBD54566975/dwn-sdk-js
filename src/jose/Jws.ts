import * as ed25519 from '@noble/ed25519';
import * as secp256k1 from '@noble/secp256k1';
import base64url from 'base64url';
import type { JwkEd25519Private, JwkEd25519Public, JwkPrivate, JwkPublic, JwkSecp256k1Private, JwkSecp256k1Public } from './jwk-types';
import type { JwsFlattened } from './jws-flattened';

/**
 * Class containing reusable JWS operations.
 */
export class Jws {
  /**
   * Signs the given payload as a JWS.
   * NOTE: this is mainly used by tests to create valid test data.
   * @throws {Error} if key given is unsupported.
   */
  public static async sign (
    protectedHeader: object,
    payload: Buffer,
    privateKeyJwk: JwkPrivate
  ): Promise<JwsFlattened> {

    const protectedHeaderString = JSON.stringify(protectedHeader);
    const protectedHeaderBase64UrlString = base64url.encode(protectedHeaderString);
    const payloadBase64UrlString = base64url.encode(payload);
    const signingInputBase64urlString = protectedHeaderBase64UrlString + '.' + payloadBase64UrlString;
    const signingInputBuffer = Buffer.from(signingInputBase64urlString);

    // This is where we will add support for different algorithms over time.
    let signatureBuffer: Buffer;
    if (privateKeyJwk.crv === 'Ed25519') {
      signatureBuffer = await Jws.signEd25519(signingInputBuffer, privateKeyJwk as JwkEd25519Private);
    } else if (privateKeyJwk.crv === 'secp256k1') {
      signatureBuffer = await Jws.signSecp256k1(signingInputBuffer, privateKeyJwk as JwkSecp256k1Private);
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
    privateKeyJwk: JwkEd25519Private
  ): Promise<Buffer> {
    const privateKeyBuffer = base64url.toBuffer(privateKeyJwk.d);
    const signatureUint8Array = await ed25519.sign(signingInputBuffer, privateKeyBuffer);
    const signatureBuffer = Buffer.from(signatureUint8Array);
    return signatureBuffer;
  }

  /**
   * Implementation of signing using SECP256K1.
   */
  private static async signSecp256k1 (
    signingInputBuffer: Buffer,
    privateKeyJwk: JwkSecp256k1Private
  ): Promise<Buffer> {
    const privateKeyBuffer = base64url.toBuffer(privateKeyJwk.d);
    const signatureUint8Array = await secp256k1.sign(signingInputBuffer, privateKeyBuffer);
    const signatureBuffer = Buffer.from(signatureUint8Array);
    return signatureBuffer;
  }

  /**
   * Verifies the JWS signature.
   * @returns `true` if signature is successfully verified, false otherwise.
   * @throws {Error} if key given is unsupported.
   */
  public static async verify (
    jwsFlattenedModel: JwsFlattened,
    publicKeyJwk: JwkPublic
  ): Promise<boolean> {
    const signatureInput = jwsFlattenedModel.protected + '.' + jwsFlattenedModel.payload;
    const signatureInputBuffer = Buffer.from(signatureInput);
    const signatureBuffer = base64url.toBuffer(jwsFlattenedModel.signature);

    // This is where we will add support for different algorithms over time.
    let result = false;
    if (publicKeyJwk.crv === 'Ed25519') {
      result = await Jws.verifyEd25519(signatureInputBuffer, signatureBuffer, publicKeyJwk as JwkEd25519Public);
    } else if (publicKeyJwk.crv === 'secp256k1') {
      result = await Jws.verifySecp256k1(signatureInputBuffer, signatureBuffer, publicKeyJwk as JwkSecp256k1Public);
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
    publicKeyJwk: JwkEd25519Public
  ): Promise<boolean> {
    const publicKeyBuffer = base64url.toBuffer(publicKeyJwk.x);
    const result = await ed25519.verify(signatureBuffer, signatureInputBuffer, publicKeyBuffer);
    return result;
  }

  /**
   * Implementation of signature verification using SECP256K1.
   */
  private static async verifySecp256k1 (
    signatureInputBuffer: Buffer,
    signatureBuffer: Buffer,
    publicKeyJwk: JwkSecp256k1Public
  ): Promise<boolean> {
    const identifierByte = Buffer.from([0x04]);
    const xBuffer = base64url.toBuffer(publicKeyJwk.x);
    const yBuffer = base64url.toBuffer(publicKeyJwk.y);
    const publicKeyBuffer = Buffer.concat([identifierByte, xBuffer, yBuffer]);
    const result = await secp256k1.verify(signatureBuffer, signatureInputBuffer, publicKeyBuffer);
    return result;
  }
}

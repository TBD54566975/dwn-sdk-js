import type { PrivateJwk, PublicJwk } from '../types/jose-types.js';

import { Secp256k1 } from './secp256k1.js';

export enum KeyDerivationScheme {
  /**
   * Key derivation using the `dataFormat` value for Flat-space records.
   */
  DataFormats = 'dataFormats',
  ProtocolContext = 'protocolContext',
  ProtocolPath = 'protocolPath',
  /**
   * Key derivation using the `schema` value for Flat-space records.
   */
  Schemas = 'schemas'
}

export type DerivedPrivateJwk = {
  rootKeyId: string,
  derivationScheme: KeyDerivationScheme;
  derivationPath?: string[];
  derivedPrivateKey: PrivateJwk,
};

/**
 * Class containing hierarchical deterministic key related utility methods used by the DWN.
 */
export class HdKey {
  /**
   * Derives a descendant private key.
   * NOTE: currently only supports SECP256K1 keys.
   */
  public static async derivePrivateKey(ancestorKey: DerivedPrivateJwk, subDerivationPath: string[]): Promise<DerivedPrivateJwk> {
    const ancestorPrivateKey = Secp256k1.privateJwkToBytes(ancestorKey.derivedPrivateKey);
    const ancestorPrivateKeyDerivationPath = ancestorKey.derivationPath ?? [];
    const derivedPrivateKeyBytes = await Secp256k1.derivePrivateKey(ancestorPrivateKey, subDerivationPath);
    const derivedPrivateJwk = await Secp256k1.privateKeyToJwk(derivedPrivateKeyBytes);
    const derivedDescendantPrivateKey: DerivedPrivateJwk = {
      rootKeyId         : ancestorKey.rootKeyId,
      derivationScheme  : ancestorKey.derivationScheme,
      derivationPath    : [...ancestorPrivateKeyDerivationPath, ...subDerivationPath],
      derivedPrivateKey : derivedPrivateJwk
    };

    return derivedDescendantPrivateKey;
  }

  /**
   * Derives a descendant public key from an ancestor private key.
   * NOTE: currently only supports SECP256K1 keys.
   */
  public static async derivePublicKey(ancestorKey: DerivedPrivateJwk, subDerivationPath: string[]): Promise<PublicJwk> {
    const derivedDescendantPrivateKey = await HdKey.derivePrivateKey(ancestorKey, subDerivationPath);
    const derivedDescendantPublicKey = await Secp256k1.getPublicJwk(derivedDescendantPrivateKey.derivedPrivateKey);

    return derivedDescendantPublicKey;
  }
}
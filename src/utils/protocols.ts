import type { DerivedPrivateJwk } from '../utils/hd-key.js';
import type { PrivateJwk } from '../types/jose-types.js';
import type { ProtocolDefinition, ProtocolRuleSet } from '../types/protocols-types.js';

import { Secp256k1 } from './secp256k1.js';
import { HdKey, KeyDerivationScheme } from '../utils/hd-key.js';

/**
 * Class containing Protocol related utility methods.
 */
export class Protocols {
  /**
   * Derives public encryptions keys and inject it in the `$encryption` property for each protocol path segment of the given Protocol definition,
   * then returns the final encryption-enabled protocol definition.
   * NOTE: The original definition passed in is unmodified.
   */
  public static async deriveAndInjectPublicEncryptionKeys(
    protocolDefinition: ProtocolDefinition,
    rootKeyId: string,
    privateJwk: PrivateJwk
  ): Promise<ProtocolDefinition> {
    // clone before modify
    const encryptionEnabledProtocolDefinition = JSON.parse(JSON.stringify(protocolDefinition)) as ProtocolDefinition;

    // a function that recursively creates and adds `$encryption` property to every rule set
    async function addEncryptionProperty(ruleSet: ProtocolRuleSet, parentKey: DerivedPrivateJwk): Promise<void> {
      for (const key in ruleSet) {
        // if we encounter a nested rule set (a property name that doesn't begin with '$'), recursively inject the `$encryption` property
        if (!key.startsWith('$')) {
          const derivedPrivateKey = await HdKey.derivePrivateKey(parentKey, [key]);
          const publicKeyJwk = await Secp256k1.getPublicJwk(derivedPrivateKey.derivedPrivateKey);

          ruleSet[key].$encryption = { rootKeyId, publicKeyJwk };
          await addEncryptionProperty(ruleSet[key], derivedPrivateKey);
        }
      }
    }

    // inject encryption property starting from each root level record type
    const rootKey: DerivedPrivateJwk = {
      derivationScheme  : KeyDerivationScheme.ProtocolPath,
      derivedPrivateKey : privateJwk,
      rootKeyId
    };
    const protocolLevelDerivedKey = await HdKey.derivePrivateKey(rootKey, [KeyDerivationScheme.ProtocolPath, protocolDefinition.protocol]);
    await addEncryptionProperty(encryptionEnabledProtocolDefinition.structure, protocolLevelDerivedKey);

    return encryptionEnabledProtocolDefinition;
  }
}
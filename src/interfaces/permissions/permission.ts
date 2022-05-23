import ms from 'ms';
import { getUnixTime } from 'date-fns';

/**
 * TODO: add documentation
 */
// TODO: add `fct` (Moe - 03/22/2022)
export class Permission {
  iss: string; // the issuer of this permission
  aud: string; // the receiver of this permission
  att: Capability[]; // attentuations
  nbf: number; // not before UTC unix timestamp
  exp: number; // expiration UTC unix timestamp
  nnc: string; // nonce
  prf: string[]; // proof of delegation

  static optionsMap = {
    expiration : { member: 'exp', transform: this.toUnixEpochSeconds },
    notBefore  : { member: 'nbf', transform: this.toUnixEpochSeconds },
    nonce      : { member: 'nnc' }
  };

  constructor(issuer: string, subject: string, capability: Capability, opts: PermissionOpts = {}) {
    this.iss = issuer;
    this.aud = subject;
    this.att = [capability];

    // assign all optional values
    for (const opt in opts) {
      const value = opts[opt];
      const { member, transform } = Permission.optionsMap[opt];

      this[member] = transform ? transform(value) : value;
    }

    Permission.validate(this);
  }

  /**
   * TODO: add docs
   * @param permission
   * @returns
   */
  static validate(permission: Permission): void {
    return null;
  }

  /**
   * TODO: add docs
   * @param value
   * @returns
   */
  static toUnixEpochSeconds(value: string | number | Date): number {
    if (typeof value === 'number') {
      return value;
    } else if (typeof value === 'string') {
      const duration = ms(value);

      return getUnixTime(Date.now() + duration);
    } else if (value instanceof Date) {
      return getUnixTime(value);
    }
  }
}

/**
 * optional configurations for a permission
 * @param expiration - expiration date of the permission.
 * can be provided as a Date, an {@link https://www.npmjs.com/package/ms|`ms` compatible duration}
 * or UNIX epoch in seconds
 * @param notBefore - time after which the permission can be used
 * can be provided as a Date, an {@link https://www.npmjs.com/package/ms|`ms` compatible duration}
 *  or UNIX epoch in seconds
 * @param nonce - helps prevent replay attacks and ensures a unique CID per delegation.
 */
// TODO: add option for `prf`
type PermissionOpts = {
  expiration?: Date | string | number
  nonce?: string,
  notBefore?: Date | string | number
};

/**
 * A capability (often referred to as “caveat” in previous OCAP art) is used
 * to attenuate the scope of a permission
 */
export type Capability = {
  with: string, // MUST be the DID of the issuer
  can: Ability,
  conditions: Conditions
};

/**
 * TODO: add docs (Moe - 03/22/2022)
 */
export type Ability = {
  description: string
  method: string,
  schema?: string,
  objectId?: string,
};

/**
 * TODO: add docs (Moe - 03/22/2022)
 */
export type Conditions = {
  // delegation indicates that a given permission can be delegated to other entities.
  // defaults to `false`
  delegation?: boolean,
  // encryption indicates whether any inbound data should be encrypted.
  // defaults to `MAY`
  encryption?: EncryptionCondition
  // attestation indicates whether any inbound data should be signed.
  // defaults to `MAY`
  attestation?: AttestationCondition

  // sharedAccess indicates whether the requester has access to records authored
  // by others. False indicates that the requester only has access to records
  // they authored.
  // defaults to `false`
  sharedAccess?: boolean
};

export enum AttestationCondition {
  MUST_NOT = 0,
  MAY = 1,
  MUST = 2
};

export enum EncryptionCondition {
  MUST_NOT = 0,
  MAY = 1,
  MUST = 2
};
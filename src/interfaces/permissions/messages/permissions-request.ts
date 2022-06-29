import type { AuthCreateOpts as AuthCreateOptions, Authorizable, AuthVerificationResult } from '../../../core/types';
import type { PermissionsRequestSchema, PermissionsRequestDescriptor } from '../types';
import type { Scope, Conditions } from '../types';

import { DIDResolver } from '../../../did/did-resolver';
import { GeneralJwsSigner, GeneralJwsVerifier } from '../../../jose/jws/general';
import { generateCid, parseCid } from '../../../utils/cid';
import lodash from 'lodash';
import { Message } from '../../../core/message';
import { v4 as uuidv4 } from 'uuid';

const { isPlainObject } = lodash;

type PermissionsRequestOptions = AuthCreateOptions & {
  conditions?: Conditions;
  description: string;
  grantedTo: string;
  grantedBy: string;
  objectId?: string;
  scope: Scope;
};

export class PermissionsRequest extends Message implements Authorizable {
  protected message: PermissionsRequestSchema;

  constructor(message: PermissionsRequestSchema) {
    super(message);
  }

  get conditions(): Conditions {
    return this.message.descriptor.conditions;
  }

  get grantedBy(): string {
    return this.message.descriptor.grantedBy;
  }

  get grantedTo(): string {
    return this.message.descriptor.grantedTo;
  }

  get description(): string {
    return this.message.descriptor.description;
  }

  get scope(): Scope {
    return this.message.descriptor.scope;
  }

  static getType(): string {
    return 'PermissionsRequest';
  }

  static getInterface(): string {
    return 'Permissions';
  }

  static async create(opts: PermissionsRequestOptions): Promise<PermissionsRequest> {
    const { conditions } = opts;
    const providedConditions = conditions ? conditions : {};
    const mergedConditions = { ...DEFAULT_CONDITIONS, ...providedConditions  };

    const descriptor: PermissionsRequestDescriptor = {
      conditions  : mergedConditions,
      description : opts.description,
      grantedTo   : opts.grantedTo,
      grantedBy   : opts.grantedBy,
      method      : 'PermissionsRequest',
      objectId    : opts.objectId ? opts.objectId : uuidv4(),
      scope       : opts.scope,
    };

    const descriptorCid = await generateCid(descriptor);

    const authPayload = { descriptorCid: descriptorCid.toString() };
    const authPayloadStr = JSON.stringify(authPayload);
    const authPayloadBytes = new TextEncoder().encode(authPayloadStr);

    const signer = await GeneralJwsSigner
      .create(authPayloadBytes, [opts.signatureInput]);

    const message: PermissionsRequestSchema = { descriptor, authorization: signer.getJws() };

    return new PermissionsRequest(message);
  }

  /**
   * @throws {Error} if descriptorCid is missing from Auth payload
   */
  async verifyAuth(didResolver: DIDResolver): Promise<AuthVerificationResult> {
    const verifier = new GeneralJwsVerifier(this.message.authorization);

    // signature verification is computationally intensive, so we're going to start
    // by validating the payload.

    const payloadBytes: Uint8Array = verifier.decodePayload();
    const payloadStr = new TextDecoder().decode(payloadBytes);
    let payloadJson;

    try {
      payloadJson = JSON.parse(payloadStr);
    } catch {
      throw new Error('auth payload must be a valid JSON object');
    }

    if(!isPlainObject(payloadJson)) {
      throw new Error('auth payload must be a valid JSON object');
    }

    const { descriptorCid } = payloadJson;
    if (!descriptorCid) {
      throw new Error('descriptorCid must be present in authorization payload');
    }

    // parseCid throws an exception if parsing fails
    const providedDescriptorCid = parseCid(descriptorCid);
    const expectedDescriptorCid = await generateCid(this.message.descriptor);

    if (!providedDescriptorCid.equals(expectedDescriptorCid)) {
      throw new Error('provided descriptorCid does not match expected CID');
    }

    const { signers } = await verifier.verify(didResolver);

    return { signers };
  }
}

export const DEFAULT_CONDITIONS: Conditions = {
  attestation  : 'optional',
  delegation   : false,
  encryption   : 'optional',
  publication  : false,
  sharedAccess : false
};
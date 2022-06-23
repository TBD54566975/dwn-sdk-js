import type { AuthCreateOpts } from '../../../messages/types';
import type { JsonPermissionsRequest, PermissionsRequestDescriptor } from './types';
import type { Scope, Conditions } from '../types';

import { GeneralJwsSigner } from '../../../jose/jws/general/signer';
import { generateCid } from '../../../utils/cid';
import { Message } from '../../../messages/message';
import { v4 as uuidv4 } from 'uuid';

type PermissionsRequestOpts = AuthCreateOpts & {
  conditions?: Conditions;
  description: string;
  grantedTo: string;
  grantedBy: string;
  objectId?: string;
  scope: Scope;
};

export class PermissionsRequest extends Message {
  protected message: JsonPermissionsRequest;

  constructor(message: JsonPermissionsRequest) {
    super(message);
  }

  get grantedBy(): string {
    return this.message.descriptor.grantedBy;
  }

  get grantedTo(): string {
    return this.message.descriptor.grantedTo;
  }

  get conditions(): Conditions {
    return this.message.descriptor.conditions;
  }

  get scope(): Scope {
    return this.message.descriptor.scope;
  }

  static getType(): string {
    return 'PermissionsRequest';
  }

  static async create(opts: PermissionsRequestOpts): Promise<PermissionsRequest> {
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

    const authPayload = { descriptorCid: await generateCid(descriptor) };
    const authPayloadStr = JSON.stringify(authPayload);
    const authPayloadBytes = new TextEncoder().encode(authPayloadStr);

    const signer = await GeneralJwsSigner
      .create(authPayloadBytes, [opts.signingMaterial]);

    const message: JsonPermissionsRequest = { descriptor, authorization: signer.getJws() };

    return new PermissionsRequest(message);
  }

  getInterface(): string {
    return 'Permissions';
  }
}

export const DEFAULT_CONDITIONS: Conditions = {
  attestation  : 'optional',
  delegation   : false,
  encryption   : 'optional',
  publication  : false,
  sharedAccess : false
};
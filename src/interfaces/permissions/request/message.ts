import type { AuthCreateOpts } from '../../../messages/types';
import type { JsonPermissionsRequest, PermissionsRequestDescriptor } from './types';
import type { Scope, Conditions } from '../types';

import schema from './schema.json';

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

export class PermissionsRequest extends Message<JsonPermissionsRequest> {
  message: JsonPermissionsRequest;

  constructor(message: JsonPermissionsRequest) {
    super(message);
  }

  static getJsonSchema(): object {
    return schema;
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
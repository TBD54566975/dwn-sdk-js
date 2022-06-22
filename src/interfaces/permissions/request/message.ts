import type { JsonPermissionsRequest } from './types';
import type { Scope, Conditions } from '../types';
import type { JwkPrivate } from '../../../jose/types';
import { Message } from '../../../messages/message';

import { v4 as uuidv4 } from 'uuid';

type PermissionsRequestOpts = {
  conditions?: Conditions
  description: string,
  grantedTo: string,
  grantedBy: string,
  objectId?: string,
  scope: Scope,
  signer: JwkPrivate
};

export class PermissionsRequest extends Message<JsonPermissionsRequest> {
  message: JsonPermissionsRequest;

  constructor(message: JsonPermissionsRequest) {
    super(message);
  }

  static async create(opts: PermissionsRequestOpts): Promise<PermissionsRequest> {
    const { conditions } = opts;
    const providedConditions = conditions ? conditions : {};
    const mergedConditions = { ...DEFAULT_CONDITIONS, ...providedConditions  };

    const descriptor = {
      conditions  : mergedConditions,
      description : opts.description,
      grantedTo   : opts.grantedTo,
      grantedBy   : opts.grantedBy,
      method      : 'PermissionsRequest',
      objectId    : opts.objectId ? opts.objectId : uuidv4(),
      scope       : opts.scope,
    };


    const permissionsRequest = new PermissionsRequest(opts);
    await permissionsRequest.sign(opts.signer);

    return permissionsRequest;
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
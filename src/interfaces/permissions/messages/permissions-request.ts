import type { AuthCreateOptions, Authorizable, AuthVerificationResult } from '../../../core/types';
import type { PermissionsRequestDescriptor, PermissionsRequestMessage } from '../types';
import type { PermissionScope, PermissionConditions } from '../types';

import { canonicalAuth } from '../../../core/auth';
import { DidResolver } from '../../../did/did-resolver';
import { Jws } from '../../../jose/jws/jws';
import { Message } from '../../../core/message';
import { MessageStore } from '../../../store/message-store';
import { v4 as uuidv4 } from 'uuid';
import { validate } from '../../../validation/validator';

type PermissionsRequestOptions = AuthCreateOptions & {
  target: string;
  dateCreated?: number;
  conditions?: PermissionConditions;
  description: string;
  grantedTo: string;
  grantedBy: string;
  objectId?: string;
  scope: PermissionScope;
};

export class PermissionsRequest extends Message implements Authorizable {
  protected message: PermissionsRequestMessage;

  constructor(message: PermissionsRequestMessage) {
    super(message);
  }

  static async create(opts: PermissionsRequestOptions): Promise<PermissionsRequest> {
    const { conditions } = opts;
    const providedConditions = conditions ? conditions : {};
    const mergedConditions = { ...DEFAULT_CONDITIONS, ...providedConditions };

    const descriptor: PermissionsRequestDescriptor = {
      target      : opts.target,
      dateCreated : opts.dateCreated ?? Date.now(),
      conditions  : mergedConditions,
      description : opts.description,
      grantedTo   : opts.grantedTo,
      grantedBy   : opts.grantedBy,
      method      : 'PermissionsRequest',
      objectId    : opts.objectId ? opts.objectId : uuidv4(),
      scope       : opts.scope,
    };

    const messageType = descriptor.method;
    validate(messageType, { descriptor, authorization: {} });

    const auth = await Jws.sign({ descriptor }, opts.signatureInput);
    const message: PermissionsRequestMessage = { descriptor, authorization: auth };

    return new PermissionsRequest(message);
  }

  async verifyAuth(didResolver: DidResolver, messageStore: MessageStore): Promise<AuthVerificationResult> {
    return await canonicalAuth(this.message, didResolver, messageStore);
  }

  get id(): string {
    return this.message.descriptor.objectId;
  }

  get conditions(): PermissionConditions {
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

  get scope(): PermissionScope {
    return this.message.descriptor.scope;
  }
}

export const DEFAULT_CONDITIONS: PermissionConditions = {
  attestation  : 'optional',
  delegation   : false,
  encryption   : 'optional',
  publication  : false,
  sharedAccess : false
};
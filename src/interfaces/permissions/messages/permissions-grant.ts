import type { AuthCreateOptions, Authorizable, AuthVerificationResult } from '../../../core/types';
import type { PermissionsGrantDescriptor, PermissionsGrantSchema } from '../types';
import type { PermissionScope, PermissionConditions } from '../types';
import type { SignatureInput } from '../../../jose/jws/general/types';

import { CID } from 'multiformats/cid';
import { authenticate, verifyAuth } from '../../../core/auth';
import { DIDResolver } from '../../../did/did-resolver';
import { generateCid } from '../../../utils/cid';
import { Message } from '../../../core/message';
import { PermissionsRequest, DEFAULT_CONDITIONS } from './permissions-request';
import { v4 as uuidv4 } from 'uuid';

type PermissionsGrantOptions = AuthCreateOptions & {
  conditions?: PermissionConditions;
  description: string;
  grantedTo: string;
  grantedBy: string;
  objectId?: string;
  permissionsRequestId?: string;
  scope: PermissionScope;
};

export class PermissionsGrant extends Message implements Authorizable {
  protected message: PermissionsGrantSchema;

  constructor(message: PermissionsGrantSchema) {
    super(message);
  }

  static async create(options: PermissionsGrantOptions): Promise<PermissionsGrant> {
    const { conditions } = options;
    const providedConditions = conditions ? conditions : {};
    const mergedConditions = { ...DEFAULT_CONDITIONS, ...providedConditions  };

    const descriptor: PermissionsGrantDescriptor = {
      conditions  : mergedConditions,
      description : options.description,
      grantedTo   : options.grantedTo,
      grantedBy   : options.grantedBy,
      method      : 'PermissionsGrant',
      objectId    : options.objectId ? options.objectId : uuidv4(),
      scope       : options.scope,
    };

    const auth = await authenticate({ descriptor }, options.signatureInput);
    const message: PermissionsGrantSchema = { descriptor, authorization: auth };

    return new PermissionsGrant(message);
  }


  /**
   * generates a PermissionsGrant using the provided PermissionsRequest
   * @param permissionsRequest
   * @param signatureInput - the private key and additional signature material of the grantor
   * @param conditionOverrides - any conditions that the grantor may want to override
   */
  static async fromPermissionsRequest(
    permissionsRequest: PermissionsRequest,
    signatureInput: SignatureInput,
    conditionOverrides: Partial<PermissionConditions> = {}
  ): Promise<PermissionsGrant> {
    const conditions = { ...permissionsRequest.conditions, ...conditionOverrides };

    return PermissionsGrant.create({
      conditions           : conditions,
      description          : permissionsRequest.description,
      grantedBy            : permissionsRequest.grantedBy,
      grantedTo            : permissionsRequest.grantedTo,
      permissionsRequestId : permissionsRequest.id,
      scope                : permissionsRequest.scope,
      signatureInput       : signatureInput
    });
  }

  /**
   * delegates the permission to the DID provided
   * @param to - the DID of the grantee
   * @param signatureInput - the private key and additional signature material of this permission's `grantedTo`
   * @throws {Error} - if the permission cannot be delegated
   */
  async delegate(to: string, signatureInput: SignatureInput): Promise<PermissionsGrant> {
    // throw an exception if the permission cannot be delegated
    if (!this.conditions.delegation) {
      throw new Error('this permission cannot be delegated');
    }

    // `grantedBy` of the delegated permission will be `grantedTo` of the permission being delegated because the grantee is the delegator
    const delegatedGrant = await PermissionsGrant.create({
      conditions     : this.conditions,
      description    : this.description,
      grantedBy      : this.grantedTo,
      grantedTo      : to,
      scope          : this.scope,
      signatureInput : signatureInput
    });

    delegatedGrant.delegatedFrom = await generateCid(this.message);
    delegatedGrant.delegationChain = this.message;

    return delegatedGrant;
  }

  verifyAuth(didResolver: DIDResolver): Promise<AuthVerificationResult> {
    return verifyAuth(this.message, didResolver);
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

  private set delegatedFrom(cid: CID) {
    this.message.descriptor.delegatedFrom = cid.toString();
  }

  private set delegationChain(parentGrant: PermissionsGrantSchema) {
    this.message.delegationChain = parentGrant;
  }
}
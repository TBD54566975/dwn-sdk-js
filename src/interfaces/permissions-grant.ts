import type { DelegatedGrantMessage } from '../types/delegated-grant-message.js';
import type { PermissionsGrantMessage } from '../types/permissions-types.js';
import type { PermissionsRequest } from './permissions-request.js';
import type { Signer } from '../types/signer.js';
import type { PermissionConditions, PermissionScope, PermissionsGrantDescriptor, RecordsPermissionScope } from '../types/permissions-grant-descriptor.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Message } from '../core/message.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { Time } from '../utils/time.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import { normalizeProtocolUrl, normalizeSchemaUrl } from '../utils/url.js';

export type PermissionsGrantOptions = {
  messageTimestamp?: string;
  dateExpires: string;
  description?: string;
  grantedTo: string;
  grantedBy: string;
  grantedFor: string;
  delegated?: boolean;
  permissionsRequestId?: string;
  scope: PermissionScope;
  conditions?: PermissionConditions;
  signer: Signer;
};

export type CreateFromPermissionsRequestOverrides = {
  dateExpires: string;
  description?: string;
  grantedTo?: string;
  grantedBy?: string;
  grantedFor?: string;
  scope?: PermissionScope;
  conditions?: PermissionConditions;
};

export class PermissionsGrant extends AbstractMessage<PermissionsGrantMessage> {

  public static async parse(message: PermissionsGrantMessage): Promise<PermissionsGrant> {
    await Message.validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);
    PermissionsGrant.validateScope(message);
    Time.validateTimestamp(message.descriptor.messageTimestamp);
    Time.validateTimestamp(message.descriptor.dateExpires);

    return new PermissionsGrant(message);
  }

  static async create(options: PermissionsGrantOptions): Promise<PermissionsGrant> {
    const scope = { ...options.scope } as RecordsPermissionScope;
    scope.protocol = scope.protocol !== undefined ? normalizeProtocolUrl(scope.protocol) : undefined;
    scope.schema = scope.schema !== undefined ? normalizeSchemaUrl(scope.schema) : undefined;

    const descriptor: PermissionsGrantDescriptor = {
      interface            : DwnInterfaceName.Permissions,
      method               : DwnMethodName.Grant,
      messageTimestamp     : options.messageTimestamp ?? Time.getCurrentTimestamp(),
      dateExpires          : options.dateExpires,
      description          : options.description,
      grantedTo            : options.grantedTo,
      grantedBy            : options.grantedBy,
      grantedFor           : options.grantedFor,
      delegated            : options.delegated,
      permissionsRequestId : options.permissionsRequestId,
      scope                : scope,
      conditions           : options.conditions,
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    const authorization = await Message.createAuthorization({ descriptor, signer: options.signer });
    const message: PermissionsGrantMessage = { descriptor, authorization };

    Message.validateJsonSchema(message);
    PermissionsGrant.validateScope(message);

    return new PermissionsGrant(message);
  }

  /**
   * A convenience method for casting a PermissionsGrantMessage to a DelegatedGrantMessage if the `delegated` property is `true`.
   * @throws {DwnError} if the `delegated` property is not `true`.
   */
  public asDelegatedGrant(): DelegatedGrantMessage {
    return PermissionsGrant.asDelegatedGrant(this.message);
  }

  /**
   * A convenience method for casting a PermissionsGrantMessage to a DelegatedGrantMessage if the `delegated` property is `true`.
   * @throws {DwnError} if the `delegated` property is not `true`.
   */
  public static asDelegatedGrant(message: PermissionsGrantMessage): DelegatedGrantMessage {
    if (!message.descriptor.delegated) {
      throw new DwnError(
        DwnErrorCode.PermissionsGrantNotADelegatedGrant,
        `PermissionsGrant given is not a delegated grant. Descriptor: ${message.descriptor}`
      );
    }

    return message as DelegatedGrantMessage;
  }


  /**
   * generates a PermissionsGrant using the provided PermissionsRequest
   * @param permissionsRequest
   * @param signer - the private key and additional signature material of the grantor
   * @param overrides - overrides that will be used instead of the properties in `permissionsRequest`
   */
  public static async createFromPermissionsRequest(
    permissionsRequest: PermissionsRequest,
    signer: Signer,
    overrides: CreateFromPermissionsRequestOverrides,
  ): Promise<PermissionsGrant> {
    const descriptor = permissionsRequest.message.descriptor;
    return PermissionsGrant.create({
      dateExpires          : overrides.dateExpires,
      description          : overrides.description ?? descriptor.description,
      grantedBy            : overrides.grantedBy ?? descriptor.grantedBy,
      grantedTo            : overrides.grantedTo ?? descriptor.grantedTo,
      grantedFor           : overrides.grantedFor ?? descriptor.grantedFor,
      permissionsRequestId : await Message.getCid(permissionsRequest.message),
      scope                : overrides.scope ?? descriptor.scope,
      conditions           : overrides.conditions ?? descriptor.conditions,
      signer,
    });
  }

  /**
   * Current implementation only allows the DWN owner to store grants they created.
   */
  public authorize(): void {
    const { grantedBy, grantedFor } = this.message.descriptor;
    if (this.author !== grantedBy) {
      throw new DwnError(DwnErrorCode.PermissionsGrantGrantedByMismatch, 'Message author must match grantedBy property');
    } else if (grantedBy !== grantedFor) {
      // Without delegation, only the DWN owner may grant access to their own DWN.
      throw new DwnError(
        DwnErrorCode.PermissionsGrantUnauthorizedGrant,
        `${grantedBy} is not authorized to give access to the DWN belonging to ${grantedFor}`
      );
    }
  }

  /**
   * Validates scope structure for properties beyond `interface` and `method`.
   * Currently only grants for RecordsRead and RecordsWrite have such properties and need validation beyond JSON Schema.
   */
  public static validateScope(permissionsGrantMessage: PermissionsGrantMessage): void {
    const recordsScope = permissionsGrantMessage.descriptor.scope as RecordsPermissionScope;

    // `schema` scopes may not have protocol-related fields
    if (recordsScope.schema !== undefined) {
      if (recordsScope.protocol !== undefined || recordsScope.contextId !== undefined || recordsScope.protocolPath) {
        throw new DwnError(
          DwnErrorCode.PermissionsGrantScopeSchemaProhibitedFields,
          'PermissionsGrants for RecordsRead and RecordsWrite that have `schema` present may not also have protocol-related properties present'
        );
      }
    }

    if (recordsScope.protocol !== undefined) {
      // `contextId` and `protocolPath` are mutually exclusive
      if (recordsScope.contextId !== undefined && recordsScope.protocolPath !== undefined) {
        throw new DwnError(
          DwnErrorCode.PermissionsGrantScopeContextIdAndProtocolPath,
          'PermissionsGrants for RecordsRead and RecordsWrite may not have both `contextId` and `protocolPath` present'
        );
      }
    }
  }
}

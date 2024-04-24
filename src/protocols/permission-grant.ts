import type { RecordsQueryReplyEntry, RecordsWriteMessage } from '../types/records-types.js';

import type { PermissionConditions, PermissionGrantData, PermissionScope } from '../types/permission-types.js';

import { Encoder } from '../utils/encoder.js';
import { Message } from '../core/message.js';


/**
 * A class representing a Permission Grant for a more convenient abstraction.
 */
export class PermissionGrant {

  /**
   * The ID of the permission grant, which is the record ID DWN message.
   */
  public readonly id: string;

  /**
   * The grantor of the permission.
   */
  public readonly grantor: string;

  /**
   * The grantee of the permission.
   */
  public readonly grantee: string;

  /**
   * The date at which the grant was given.
   */
  public readonly dateGranted: string;

  /**
   * Optional string that communicates what the grant would be used for
   */
  public readonly description?: string;

  /**
   * Optional CID of a permission request. This is optional because grants may be given without being officially requested
   */
  public readonly requestId?: string;

  /**
   * Timestamp at which this grant will no longer be active.
   */
  public readonly dateExpires: string;

  /**
   * Whether this grant is delegated or not. If `true`, the `grantedTo` will be able to act as the `grantedTo` within the scope of this grant.
   */
  public readonly delegated?: boolean;

  /**
   * The scope of the allowed access.
   */
  public readonly scope: PermissionScope;

  /**
   * Optional conditions that must be met when the grant is used.
   */
  public readonly conditions?: PermissionConditions;

  public static async parse(message: RecordsWriteMessage): Promise<PermissionGrant> {
    const permissionGrant = new PermissionGrant(message);
    return permissionGrant;
  }

  /**
   * Creates a Permission Grant abstraction for
   */
  private constructor(message: RecordsWriteMessage) {
    // properties derived from the generic DWN message properties
    this.id = message.recordId;
    this.grantor = Message.getSigner(message)!;
    this.grantee = message.descriptor.recipient!;
    this.dateGranted = message.descriptor.dateCreated;

    // properties from the data payload itself.
    const permissionGrantEncoded = (message as RecordsQueryReplyEntry).encodedData!;
    const permissionGrant = Encoder.base64UrlToObject(permissionGrantEncoded) as PermissionGrantData;
    this.dateExpires = permissionGrant.dateExpires;
    this.delegated = permissionGrant.delegated;
    this.description = permissionGrant.description;
    this.requestId = permissionGrant.requestId;
    this.scope = permissionGrant.scope;
    this.conditions = permissionGrant.conditions;
  }
}


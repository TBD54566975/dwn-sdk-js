import type { GenericMessage } from '../types/message-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { ProtocolDefinition } from '../types/protocols-types.js';
import type { Signer } from '../types/signer.js';
import type { DataEncodedRecordsWriteMessage, RecordsWriteMessage } from '../types/records-types.js';
import type { PermissionConditions, PermissionGrantData, PermissionRequestData, PermissionRevocationData, PermissionScope, RecordsPermissionScope } from '../types/permission-types.js';

import { Encoder } from '../utils/encoder.js';
import { PermissionGrant } from './permission-grant.js';
import { RecordsWrite } from '../../src/interfaces/records-write.js';
import { Time } from '../utils/time.js';
import { validateJsonSchema } from '../schema-validator.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import { normalizeProtocolUrl, normalizeSchemaUrl } from '../utils/url.js';

/**
 * Options for creating a permission request.
 */
export type PermissionRequestCreateOptions = {
  /**
   * The signer of the request.
   */
  signer?: Signer;

  dateRequested?: string;

  // remaining properties are contained within the data payload of the record

  description?: string;
  delegated: boolean;
  scope: PermissionScope;
  conditions?: PermissionConditions;
};

/**
 * Options for creating a permission grant.
 */
export type PermissionGrantCreateOptions = {
  /**
   * The signer of the grant.
   */
  signer?: Signer;
  grantedTo: string;
  dateGranted?: string;

  // remaining properties are contained within the data payload of the record

  /**
   * Expire time in UTC ISO-8601 format with microsecond precision.
   */
  dateExpires: string;
  requestId?: string;
  description?: string;
  delegated?: boolean;
  scope: PermissionScope;
  conditions?: PermissionConditions;
};

/**
 * Options for creating a permission revocation.
 */
export type PermissionRevocationCreateOptions = {
  /**
   * The signer of the grant.
   */
  signer?: Signer;
  grantId: string;
  dateRevoked?: string;

  // remaining properties are contained within the data payload of the record

  description?: string;
};

/**
 * This is a first-class DWN protocol for managing permission grants of a given DWN.
 */
export class PermissionsProtocol {
  /**
   * The URI of the DWN Permissions protocol.
   */
  public static readonly uri = 'https://tbd.website/dwn/permissions';

  /**
   * The protocol path of the `request` record.
   */
  public static readonly requestPath = 'request';

  /**
   * The protocol path of the `grant` record.
   */
  public static readonly grantPath = 'grant';

  /**
   * The protocol path of the `revocation` record.
   */
  public static readonly revocationPath = 'grant/revocation';

  /**
   * The definition of the Permissions protocol.
   */
  public static readonly definition: ProtocolDefinition = {
    published : true,
    protocol  : PermissionsProtocol.uri,
    types     : {
      request: {
        dataFormats: ['application/json']
      },
      grant: {
        dataFormats: ['application/json']
      },
      revocation: {
        dataFormats: ['application/json']
      }
    },
    structure: {
      request: {
        $size: {
          max: 10000
        },
        $actions: [
          {
            who : 'anyone',
            can : ['create']
          }
        ]
      },
      grant: {
        $size: {
          max: 10000
        },
        $actions: [
          {
            who : 'recipient',
            of  : 'grant',
            can : ['read', 'query']
          }
        ],
        revocation: {
          $size: {
            max: 10000
          },
          $actions: [
            {
              who : 'anyone',
              can : ['read']
            }
          ]
        }
      }
    }
  };

  public static parseRequest(base64UrlEncodedRequest: string): PermissionRequestData {
    return Encoder.base64UrlToObject(base64UrlEncodedRequest);
  }

  /**
   * Convenience method to create a permission request.
   */
  public static async createRequest(options: PermissionRequestCreateOptions): Promise<{
    recordsWrite: RecordsWrite,
    permissionRequestData: PermissionRequestData,
    permissionRequestBytes: Uint8Array
  }> {
    const scope = PermissionsProtocol.normalizePermissionScope(options.scope);

    const permissionRequestData: PermissionRequestData = {
      description : options.description,
      delegated   : options.delegated,
      scope,
      conditions  : options.conditions,
    };

    const permissionRequestBytes = Encoder.objectToBytes(permissionRequestData);
    const recordsWrite = await RecordsWrite.create({
      signer           : options.signer,
      messageTimestamp : options.dateRequested,
      protocol         : PermissionsProtocol.uri,
      protocolPath     : PermissionsProtocol.requestPath,
      dataFormat       : 'application/json',
      data             : permissionRequestBytes,
    });

    return {
      recordsWrite,
      permissionRequestData,
      permissionRequestBytes
    };
  }

  /**
   * Convenience method to create a permission grant.
   */
  public static async createGrant(options: PermissionGrantCreateOptions): Promise<{
    recordsWrite: RecordsWrite,
    permissionGrantData: PermissionGrantData,
    permissionGrantBytes: Uint8Array,
    dataEncodedMessage: DataEncodedRecordsWriteMessage,
  }> {
    const scope = PermissionsProtocol.normalizePermissionScope(options.scope);

    const permissionGrantData: PermissionGrantData = {
      dateExpires : options.dateExpires,
      requestId   : options.requestId,
      description : options.description,
      delegated   : options.delegated,
      scope,
      conditions  : options.conditions,
    };

    const permissionGrantBytes = Encoder.objectToBytes(permissionGrantData);
    const recordsWrite = await RecordsWrite.create({
      signer           : options.signer,
      messageTimestamp : options.dateGranted,
      dateCreated      : options.dateGranted,
      recipient        : options.grantedTo,
      protocol         : PermissionsProtocol.uri,
      protocolPath     : PermissionsProtocol.grantPath,
      dataFormat       : 'application/json',
      data             : permissionGrantBytes,
    });

    const dataEncodedMessage: DataEncodedRecordsWriteMessage = {
      ...recordsWrite.message,
      encodedData: Encoder.bytesToBase64Url(permissionGrantBytes)
    };

    return {
      recordsWrite,
      permissionGrantData,
      permissionGrantBytes,
      dataEncodedMessage
    };
  }

  /**
   * Convenience method to create a permission revocation.
   */
  public static async createRevocation(options: PermissionRevocationCreateOptions): Promise<{
    recordsWrite: RecordsWrite,
    permissionRevocationData: PermissionRevocationData,
    permissionRevocationBytes: Uint8Array
  }> {
    const permissionRevocationData: PermissionRevocationData = {
      description: options.description,
    };

    const permissionRevocationBytes = Encoder.objectToBytes(permissionRevocationData);
    const recordsWrite = await RecordsWrite.create({
      signer          : options.signer,
      parentContextId : options.grantId, // NOTE: since the grant is the root record, its record ID is also the context ID
      protocol        : PermissionsProtocol.uri,
      protocolPath    : PermissionsProtocol.revocationPath,
      dataFormat      : 'application/json',
      data            : permissionRevocationBytes,
    });

    return {
      recordsWrite,
      permissionRevocationData,
      permissionRevocationBytes
    };
  }

  /**
   * Validates the given Permissions protocol RecordsWrite. It can be a request, grant, or revocation.
   */
  public static validateSchema(recordsWriteMessage: RecordsWriteMessage, dataBytes: Uint8Array): void {
    const dataString = Encoder.bytesToString(dataBytes);
    const dataObject = JSON.parse(dataString);
    if (recordsWriteMessage.descriptor.protocolPath === PermissionsProtocol.requestPath) {
      validateJsonSchema('PermissionRequestData', dataObject);
    } else if (recordsWriteMessage.descriptor.protocolPath === PermissionsProtocol.grantPath) {
      validateJsonSchema('PermissionGrantData', dataObject);

      // more nuanced validation that are annoying/difficult to do using JSON schema
      const permissionGrantData = dataObject as PermissionGrantData;
      PermissionsProtocol.validateScope(permissionGrantData.scope);
      Time.validateTimestamp(permissionGrantData.dateExpires);
    } else if (recordsWriteMessage.descriptor.protocolPath === PermissionsProtocol.revocationPath) {
      validateJsonSchema('PermissionRevocationData', dataObject);
    } else {
      // defensive programming, should be unreachable externally
      throw new DwnError(
        DwnErrorCode.PermissionsProtocolValidateSchemaUnexpectedRecord,
        `Unexpected permission record: ${recordsWriteMessage.descriptor.protocolPath}`
      );
    }
  }



  /**
   * Fetches PermissionGrant with the specified `recordID`.
   * @returns the PermissionGrant matching the `recordId` specified.
   * @throws {Error} if PermissionGrant does not exist
   */
  public static async fetchGrant(
    tenant: string,
    messageStore: MessageStore,
    permissionGrantId: string,
  ): Promise<PermissionGrant> {

    const grantQuery = {
      recordId          : permissionGrantId,
      isLatestBaseState : true
    };
    const { messages } = await messageStore.query(tenant, [grantQuery]);
    const possibleGrantMessage: GenericMessage | undefined = messages[0];

    const dwnInterface = possibleGrantMessage?.descriptor.interface;
    const dwnMethod = possibleGrantMessage?.descriptor.method;

    if (dwnInterface !== DwnInterfaceName.Records ||
        dwnMethod !== DwnMethodName.Write ||
        (possibleGrantMessage as RecordsWriteMessage).descriptor.protocolPath !== PermissionsProtocol.grantPath) {
      throw new DwnError(
        DwnErrorCode.GrantAuthorizationGrantMissing,
        `Could not find permission grant with record ID ${permissionGrantId}.`
      );
    }

    const permissionGrantMessage = possibleGrantMessage as RecordsWriteMessage;
    const permissionGrant = await PermissionGrant.parse(permissionGrantMessage);

    return permissionGrant;
  }

  /**
   * Normalizes the given permission scope if needed.
   * @returns The normalized permission scope.
   */
  private static normalizePermissionScope(permissionScope: PermissionScope): PermissionScope {
    const scope = { ...permissionScope };

    if (PermissionsProtocol.isRecordPermissionScope(scope)) {
      // normalize protocol and schema URLs if they are present
      if (scope.protocol !== undefined) {
        scope.protocol = normalizeProtocolUrl(scope.protocol);
      }
      if (scope.schema !== undefined) {
        scope.schema = normalizeSchemaUrl(scope.schema);
      }
    }

    return scope;
  }

  /**
   * Type guard to determine if the scope is a record permission scope.
   */
  private static isRecordPermissionScope(scope: PermissionScope): scope is RecordsPermissionScope {
    return scope.interface === 'Records';
  }


  /**
   * Validates scope.
   */
  private static validateScope(scope: PermissionScope): void {
    if (!this.isRecordPermissionScope(scope)) {
      return;
    }
    // else we are dealing with a RecordsPermissionScope

    // `schema` scopes may not have protocol-related fields
    if (scope.schema !== undefined) {
      if (scope.protocol !== undefined || scope.contextId !== undefined || scope.protocolPath) {
        throw new DwnError(
          DwnErrorCode.PermissionsProtocolValidateScopeSchemaProhibitedProperties,
          'Permission grants that have `schema` present cannot also have protocol-related properties present'
        );
      }
    }

    if (scope.protocol !== undefined) {
      // `contextId` and `protocolPath` are mutually exclusive
      if (scope.contextId !== undefined && scope.protocolPath !== undefined) {
        throw new DwnError(
          DwnErrorCode.PermissionsProtocolValidateScopeContextIdProhibitedProperties,
          'Permission grants cannot have both `contextId` and `protocolPath` present'
        );
      }
    }
  }
};
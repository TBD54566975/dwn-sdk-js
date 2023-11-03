import type { DelegatedGrantMessage } from '../types/permissions-types.js';
import type { Signer } from '../types/signer.js';
import type { GenericMessage, GenericSignaturePayload, Pagination } from '../types/message-types.js';
import type { RecordsFilter, RecordsQueryDescriptor, RecordsQueryMessage } from '../types/records-types.js';

import { Jws } from '../utils/jws.js';
import { Message } from '../core/message.js';
import { Records } from '../utils/records.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { Time } from '../utils/time.js';
import { validateMessageSignatureIntegrity } from '../core/auth.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../core/message.js';
import { validateProtocolUrlNormalized, validateSchemaUrlNormalized } from '../utils/url.js';

export enum DateSort {
  CreatedAscending = 'createdAscending',
  CreatedDescending = 'createdDescending',
  PublishedAscending = 'publishedAscending',
  PublishedDescending = 'publishedDescending'
}

export type RecordsQueryOptions = {
  messageTimestamp?: string;
  filter: RecordsFilter;
  dateSort?: DateSort;
  pagination?: Pagination;
  signer?: Signer;
  protocolRole?: string;

  /**
   * The delegated grant to sign on behalf of the logical author, which is the grantor (`grantedBy`) of the delegated grant.
   */
  delegatedGrant?: DelegatedGrantMessage;
};

/**
 * A class representing a RecordsQuery DWN message.
 */
export class RecordsQuery {
  private _message: RecordsQueryMessage;
  /**
   * Valid JSON message representing this RecordsQuery.
   */
  public get message(): RecordsQueryMessage {
    return this._message as RecordsQueryMessage;
  }

  private _author: string | undefined;
  /**
   * DID of the logical author of this message.
   * NOTE: we say "logical" author because a message can be signed by a delegate of the actual author,
   * in which case the author DID would not be the same as the signer/delegate DID,
   * but be the DID of the grantor (`grantedBy`) of the delegated grant presented.
   */
  public get author(): string | undefined {
    return this._author;
  }

  private _signaturePayload: GenericSignaturePayload | undefined;
  /**
   * Decoded payload of the signature of this message.
   */
  public get signaturePayload(): GenericSignaturePayload | undefined {
    return this._signaturePayload;
  }

  private constructor(message: RecordsQueryMessage) {
    this._message = message;

    if (message.authorization !== undefined) {
      // if the message authorization contains author delegated grant, the author would be the grantor of the grant
      // else the author would be the signer of the message
      if (message.authorization.authorDelegatedGrant !== undefined) {
        this._author = Message.getSigner(message.authorization.authorDelegatedGrant);
      } else {
        this._author = Message.getSigner(message as GenericMessage);
      }

      this._signaturePayload = Jws.decodePlainObjectPayload(message.authorization.signature);
    }
  }

  public static async parse(message: RecordsQueryMessage): Promise<RecordsQuery> {
    let authorizationPayload;
    if (message.authorization !== undefined) {
      authorizationPayload = await validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);
    }

    if (authorizationPayload?.protocolRole !== undefined) {
      if (message.descriptor.filter.protocolPath === undefined) {
        throw new DwnError(
          DwnErrorCode.RecordsQueryFilterMissingRequiredProperties,
          'Role-authorized queries must include `protocolPath` in the filter'
        );
      }
    }
    if (message.descriptor.filter.protocol !== undefined) {
      validateProtocolUrlNormalized(message.descriptor.filter.protocol);
    }
    if (message.descriptor.filter.schema !== undefined) {
      validateSchemaUrlNormalized(message.descriptor.filter.schema);
    }
    Time.validateTimestamp(message.descriptor.messageTimestamp);

    return new RecordsQuery(message);
  }

  public static async create(options: RecordsQueryOptions): Promise<RecordsQuery> {
    const descriptor: RecordsQueryDescriptor = {
      interface        : DwnInterfaceName.Records,
      method           : DwnMethodName.Query,
      messageTimestamp : options.messageTimestamp ?? Time.getCurrentTimestamp(),
      filter           : Records.normalizeFilter(options.filter),
      dateSort         : options.dateSort,
      pagination       : options.pagination,
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    // only generate the `authorization` property if signature input is given
    const signer = options.signer;
    let authorization;
    if (signer) {
      authorization = await Message.createAuthorization(descriptor, signer, { protocolRole: options.protocolRole }, options.delegatedGrant);
    }
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    return new RecordsQuery(message);
  }
}

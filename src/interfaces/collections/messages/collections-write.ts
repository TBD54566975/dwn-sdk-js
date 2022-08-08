import type { AuthCreateOptions, Authorizable, AuthVerificationResult } from '../../../core/types';
import type { CollectionsWriteDescriptor, CollectionsWriteSchema } from '../types';
import { DIDResolver } from '../../../did/did-resolver';
import { Message } from '../../../core/message';
import { removeUndefinedProperties } from '../../../utils/object';
import { sign, verifyAuth } from '../../../core/auth';

type CollectionsWriteOptions = AuthCreateOptions & {
  protocol?: string;
  schema?: string;
  recordId: string;
  nonce: string;
  dataCid: string;
  dateCreated: number;
  published?: boolean;
  datePublished?: number;
  dataFormat: string;
};

function isCollectionsWriteOptions(value: any): value is CollectionsWriteOptions {
  return value !== null &&
      value.signatureInput !== null &&
      typeof value === 'object' &&
      typeof value.recordId === 'string' &&
      typeof value.nonce === 'string' &&
      typeof value.dateCreated === 'number' &&
      typeof value.dataFormat === 'string' &&
      typeof value.dataCid === 'string' &&
      typeof value.signatureInput === 'object' &&
      (typeof value.protocol === 'string' ? value.protocol : true) &&
      (typeof value.schema === 'string' ? value.schema : true) &&
      (typeof value.datePublished === 'number' ? value.datePublished == null : true) &&
      (typeof value.published === 'boolean' ? value.published == null : true);
}

export class CollectionsWrite extends Message implements Authorizable {
  protected message: CollectionsWriteSchema;

  constructor(message: CollectionsWriteSchema) {
    super(message);
  }

  static async create(options: CollectionsWriteOptions): Promise<CollectionsWrite> {
    if (!isCollectionsWriteOptions(options)) {
      throw new Error('options is incomplete');
    }

    const descriptor: CollectionsWriteDescriptor = {
      method        : 'CollectionsWrite',
      protocol      : options.protocol,
      schema        : options.schema,
      recordId      : options.recordId,
      nonce         : options.nonce,
      dataCid       : options.dataCid,
      dateCreated   : options.dateCreated,
      published     : options.published,
      datePublished : options.datePublished,
      dataFormat    : options.dataFormat
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    const authorization = await sign({ descriptor }, options.signatureInput);
    const message = { descriptor, authorization };

    return new CollectionsWrite(message);
  }

  async verifyAuth(didResolver: DIDResolver): Promise<AuthVerificationResult> {
    // TODO: Issue #75 - Add permission verification - https://github.com/TBD54566975/dwn-sdk-js/issues/75
    return await verifyAuth(this.message, didResolver);
  }
}

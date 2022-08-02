import type { AuthCreateOptions, Authorizable, AuthVerificationResult } from '../../../core/types';
import type { CollectionsQueryDescriptor, CollectionsQuerySchema } from '../types';
import { DIDResolver } from '../../../did/did-resolver';
import { Message } from '../../../core/message';
import { sign, verifyAuth } from '../../../core/auth';

type CollectionsQueryOptions = AuthCreateOptions & {
  nonce: string;
  protocol?: string;
  schema?: string;
  recordId?: string;
  dataFormat?: string;
  dateSort?: string;
};

export class CollectionsQuery extends Message implements Authorizable {
  protected message: CollectionsQuerySchema;

  constructor(message: CollectionsQuerySchema) {
    super(message);
  }

  static async create(options: CollectionsQueryOptions): Promise<CollectionsQuery> {
    const descriptor: CollectionsQueryDescriptor = {
      method     : 'CollectionsQuery',
      nonce      : options.nonce,
      protocol   : options.protocol,
      schema     : options.schema,
      recordId   : options.recordId,
      dataFormat : options.dataFormat,
      dateSort   : options.dateSort
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    Object.keys(descriptor).forEach(key => {
      if (descriptor[key] === undefined) {
        delete descriptor[key];
      }
    });

    const authorization = await sign({ descriptor }, options.signatureInput);
    const message = { descriptor, authorization };

    return new CollectionsQuery(message);
  }

  async verifyAuth(didResolver: DIDResolver): Promise<AuthVerificationResult> {
    // TODO: Issue #75 - Add permission verification - https://github.com/TBD54566975/dwn-sdk-js/issues/75
    return await verifyAuth(this.message, didResolver);
  }
}

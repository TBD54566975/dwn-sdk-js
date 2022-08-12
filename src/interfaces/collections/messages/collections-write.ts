import type { AuthCreateOptions, Authorizable, AuthVerificationResult } from '../../../core/types';
import type { CollectionsWriteDescriptor, CollectionsWriteSchema } from '../types';
import { DIDResolver } from '../../../did/did-resolver';
import { generateCid } from '../../../utils/cid';
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

export class CollectionsWrite extends Message implements Authorizable {
  protected message: CollectionsWriteSchema;

  constructor(message: CollectionsWriteSchema) {
    super(message);
  }

  static async create(options: CollectionsWriteOptions): Promise<CollectionsWrite> {
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

  /**
   * Compares the age of the given records according to the spec.
   * @returns 1 if `a` is larger/newer than `b`; -1 if `a` is smaller/older than `b`; 0 otherwise (same age)
   */
  static async compareAge(a: CollectionsWriteSchema, b: CollectionsWriteSchema): Promise<number> {
    if (a.descriptor.dateCreated > b.descriptor.dateCreated) {
      return 1;
    } else if (a.descriptor.dateCreated < b.descriptor.dateCreated) {
      return -1;
    }

    // else `dateCreated` is the same between a and b
    // compare the `dataCid` instead, the < and > operators compare strings in lexicographical order
    const cidA = await generateCid(a);
    const cidB = await generateCid(b);
    if (cidA > cidB) {
      return 1;
    } else if (cidA < cidB) {
      return -1;
    } else {
      return 0;
    }
  }
}



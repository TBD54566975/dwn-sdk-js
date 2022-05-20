import type { JwsFlattened } from '../../jose/jws';

export type CollectionsWriteMessage = {
  attestation: JwsFlattened,
  descriptor: CollectionsWriteDescriptor,
  data?: string
};

export type CollectionsWriteDescriptor = {
  // CID of a given message's `data` property. This property is required if a message contains `data`
  cid?: string,
  // unix epoch timestamp. interpreted as the time that the message was created by the requester
  dateCreated: string,
  // unix epoch timestamp. interpreted as the time that the message was sent by the requester
  datePublished?: string,
  // indicates whether the data provided in the message is encrypted.
  encryption?: 'jwe',
  method: 'CollectionsWrite',
  objectId: string,
};
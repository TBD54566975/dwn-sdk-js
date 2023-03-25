import type { MethodHandler } from '../../types.js';
import type { DidResolver, MessageStore, UploadStore } from '../../../index.js';
import type { RecordsUploadCompleteMessage, RecordsUploadPartMessage, RecordsUploadStartMessage } from '../types.js';

import { authenticate } from '../../../core/auth.js';
import { MessageReply } from '../../../core/message-reply.js';
import { RecordsUpload } from '../messages/records-upload.js';
import { DwnInterfaceName, DwnMethodName, DwnStateName } from '../../../core/message.js';

type RecordsUploadMessageVariant = RecordsUploadCompleteMessage | RecordsUploadPartMessage | RecordsUploadStartMessage;

export class RecordsUploadHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore, private uploadStore: UploadStore) { }

  public async handle({
    tenant,
    message,
    dataStream
  }): Promise<MessageReply> {
    const incomingMessage = message as RecordsUploadMessageVariant;

    let recordsUpload: RecordsUpload;
    try {
      recordsUpload = await RecordsUpload.parse(incomingMessage);
    } catch (e) {
      return new MessageReply({
        status: { code: 400, detail: e.message }
      });
    }

    // authentication & authorization
    try {
      await authenticate(incomingMessage.authorization, this.didResolver);
      await recordsUpload.authorize(tenant, this.messageStore);
    } catch (e) {
      return new MessageReply({
        status: { code: 401, detail: e.message }
      });
    }

    // get existing upload messages matching the `recordId`
    const query = {
      interface : DwnInterfaceName.Records,
      method    : DwnMethodName.Upload,
      recordId  : incomingMessage.recordId
    };
    const existingMessages = await this.messageStore.query(tenant, query) as RecordsUploadMessageVariant[];

    try {
      const existingUploadComplete = await RecordsUpload.getUploadComplete(existingMessages);
      if (existingUploadComplete) {
        return new MessageReply({
          status: { code: 400, detail: 'upload already complete' }
        });
      }
    } catch (e) {
      // ignore error if upload complete cannot be found
    }

    const newMessageIsUploadStart = await recordsUpload.isUploadStart();

    try {
      const existingUploadStart = await RecordsUpload.getUploadStart(existingMessages);
      if (existingUploadStart) {
        if (newMessageIsUploadStart) {
          return new MessageReply({
            status: { code: 400, detail: 'cannot start an upload more than once' }
          });
        }

        RecordsUpload.verifyEqualityOfImmutableProperties(existingUploadStart, incomingMessage);
      }
    } catch (e) {
      // it's ok to not find the upload start if the new message is the upload start
      if (!newMessageIsUploadStart) {
        return new MessageReply({
          status: { code: 400, detail: e.message }
        });
      }
    }

    try {
      for (const existingMessage of existingMessages) {
        RecordsUpload.verifyExclusivityOfUniqueProperties(existingMessage, incomingMessage);
      }
    } catch (e) {
      return new MessageReply({
        status: { code: 400, detail: e.message }
      });
    }

    const newMessageIsUploadComplete = await recordsUpload.isUploadComplete();
    if (newMessageIsUploadComplete) {
      const uploadComplete = incomingMessage as RecordsUploadCompleteMessage;

      const indexes = new Set<number>();

      for (const existingMessage of existingMessages) {
        if (existingMessage.descriptor.state === DwnStateName.Part) {
          const uploadPart = existingMessage as RecordsUploadPartMessage;

          // we already checked above that each index is unique
          indexes.add(uploadPart.descriptor.index);
        }
      }

      // make sure we have all the parts
      for (let index = 0; index < uploadComplete.descriptor.count; ++index) {
        if (!indexes.has(index)) {
          return new MessageReply({
            status: { code: 400, detail: `missing index '${index}'` }
          });
        }

        indexes.delete(index);
      }

      // make sure we don't have any extra parts
      for (const index of indexes) {
        return new MessageReply({
          status: { code: 400, detail: `extra index '${index}'` }
        });
      }
    }

    let result;

    switch (incomingMessage.descriptor.state) {
    case DwnStateName.Complete:
      var uploadComplete = incomingMessage as RecordsUploadCompleteMessage;
      result = await this.uploadStore.complete(tenant, uploadComplete.recordId, uploadComplete.descriptor.count);
      break;

    case DwnStateName.Part:
      var uploadPart = incomingMessage as RecordsUploadPartMessage;
      result = await this.uploadStore.part(tenant, uploadPart.recordId, uploadPart.descriptor.index, dataStream);
      break;

    case DwnStateName.Start:
      var uploadStart = incomingMessage as RecordsUploadStartMessage;
      result = await this.uploadStore.start(tenant, uploadStart.recordId, uploadStart.descriptor.dataFormat);
      break;
    }

    if (!result) {
      return new MessageReply({
        status: { code: 400, detail: 'cannot start upload' }
      });
    }

    // MUST verify that the size of the actual data matches with the given `dataSize`
    // if data size is wrong, delete the data we just stored
    if (message.descriptor.dataSize !== result.dataSize) {
      // there is an opportunity to improve here: handle the edge case of if the delete fails...
      await this.uploadStore.delete(tenant, incomingMessage.recordId);

      return new MessageReply({
        status: {
          code   : 400,
          detail : `actual data size ${result.dataSize} bytes does not match dataSize in descriptor: ${message.descriptor.dataSize}`
        }
      });
    }

    // MUST verify that the CID of the actual data matches with the given `dataCid`
    // if data CID is wrong, delete the data we just stored
    if (message.descriptor.dataCid !== result.dataCid) {
      // there is an opportunity to improve here: handle the edge case of if the delete fails...
      await this.uploadStore.delete(tenant, incomingMessage.recordId);

      return new MessageReply({
        status: {
          code   : 400,
          detail : `actual data CID ${result.dataCid} does not match dataCid in descriptor: ${message.descriptor.dataCid}`
        }
      });
    }

    const indexes = await constructRecordsUploadIndexes(recordsUpload);

    await this.messageStore.put(tenant, incomingMessage, indexes);

    return new MessageReply({
      status: { code: 202, detail: 'Accepted' }
    });
  }
}

export async function constructRecordsUploadIndexes(
  recordsUpload: RecordsUpload
): Promise<{ [key: string]: string }> {
  const message = recordsUpload.message;
  const descriptor = { ...message.descriptor };

  const indexes: { [key: string]: any } = {
    ...descriptor,
    author   : recordsUpload.author,
    recordId : message.recordId,
    entryId  : await RecordsUpload.getEntryId(recordsUpload.author, recordsUpload.message.descriptor)
  };

  // add additional indexes to optional values if given
  // TODO: index multi-attesters to be unblocked by #205 - Revisit database interfaces (https://github.com/TBD54566975/dwn-sdk-js/issues/205)
  if (recordsUpload.attesters.length > 0) { indexes.attester = recordsUpload.attesters[0]; }

  return indexes;
}

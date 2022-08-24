import type { CollectionsWriteSchema } from '../types';
import type { MethodHandler } from '../../types';

import { base64url } from 'multiformats/bases/base64';
import { CollectionsWrite } from '../messages/collections-write';
import { getDagCid } from '../../../utils/data';
import { MessageReply } from '../../../core';

export const handleCollectionsWrite: MethodHandler = async (
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
  try {
    // verify dataCid matches given data
    const incomingMessage = message as CollectionsWriteSchema;
    if (incomingMessage.encodedData !== undefined) {
      const rawData = base64url.baseDecode(incomingMessage.encodedData);
      const actualDataCid = (await getDagCid(rawData)).toString();

      if (actualDataCid !== incomingMessage.descriptor.dataCid) {
        return new MessageReply({
          status: { code: 400, message: 'actual CID of data and `dataCid` in descriptor mismatch' }
        });
      }
    }

    // authentication & authorization
    try {
      const collectionsWriteMessage = new CollectionsWrite(incomingMessage);
      await collectionsWriteMessage.verifyAuth(didResolver);
    } catch (e) {
      return new MessageReply({
        status: { code: 401, message: e.message }
      });
    }

    // get existing records matching the `recordId`
    const query = {
      target   : incomingMessage.descriptor.target,
      method   : 'CollectionsWrite',
      recordId : incomingMessage.descriptor.recordId
    };
    const existingMessages = await messageStore.query(query) as CollectionsWriteSchema[];

    // find which message is the newest, and if the incoming message is the newest
    let newestMessage = await CollectionsWrite.getNewestMessage(existingMessages);
    let incomingMessageIsNewest = false;
    if (newestMessage === undefined || await CollectionsWrite.isNewer(incomingMessage, newestMessage)) {
      incomingMessageIsNewest = true;
      newestMessage = incomingMessage;
    }

    // write the incoming message to DB if incoming message is newest
    let messageReply: MessageReply;
    if (incomingMessageIsNewest) {
      await messageStore.put(message);

      messageReply = new MessageReply({
        status: { code: 202, message: 'Accepted' }
      });
    } else {
      messageReply = new MessageReply({
        status: { code: 409, message: 'Conflict' }
      });
    }

    // delete all existing records that are not newest
    for (const message of existingMessages) {
      if (await CollectionsWrite.isNewer(newestMessage, message)) {
        const cid = await CollectionsWrite.getCid(message);
        await messageStore.delete(cid);
      }
    }

    return messageReply;
  } catch (e) {
    return new MessageReply({
      status: { code: 500, message: e.message }
    });
  }
};

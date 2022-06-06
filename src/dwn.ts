import { DIDResolver } from './did/did-resolver';
import { MessageStoreLevel } from './store/message-store-level';
import { validateMessage } from './message';
import { handlePermissionsRequest } from './interfaces/permissions';
import { IonDidResolver } from './did/ion-did-resolver';

import type { DIDMethodResolver } from './did/did-resolver';
import type { Message } from './message';
import type { MessageStore } from './store/message-store';

export class DWN {
  static methods = {
    PermissionsRequest: handlePermissionsRequest
  };

  DIDResolver: DIDResolver;
  messageStore: MessageStore;

  constructor(config: Config) {
    // override default config with any user-provided config
    const mergedConfig = { ...defaultConfig,...config };

    this.DIDResolver = new DIDResolver(mergedConfig.DIDMethodResolvers);
    this.messageStore = mergedConfig.messageStore;
  }

  /**
   * TODO: add docs
   * @param message
   */
  async processMessage(message: Message): Promise<void> {
    const { method: methodName } = message.descriptor;
    const method = DWN.methods[methodName];

    if (!method) {
      throw new Error('{methodName} is not a supported method.');
    }

    // throws exception if message is invalid
    validateMessage(message);

    await method(message, this.DIDResolver, this.messageStore);
  }
};

export type Config = {
  DIDMethodResolvers: DIDMethodResolver[],
  messageStore: MessageStore
};

const defaultConfig: Config = {
  DIDMethodResolvers : [new IonDidResolver('https://beta.discover.did.microsoft.com/1.0/identifiers/')],
  messageStore       : new MessageStoreLevel()
};
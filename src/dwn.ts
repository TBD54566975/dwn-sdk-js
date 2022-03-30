import { DIDResolver } from './did/did-resolver';

import { validateMessage } from './message';
import { PermissionsRequest } from './interfaces/permissions';

import type { Message } from './message';
import type { DIDMethodResolver } from './did/did-resolver';

export class DWN {
  static methods = { PermissionsRequest };
  DIDResolver: DIDResolver;

  constructor(config: Config) {
    this.DIDResolver = new DIDResolver(config.DIDMethodResolvers);
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

    await method(message, this.DIDResolver);
  }
};

export type Config = {
  DIDMethodResolvers: DIDMethodResolver[],
};
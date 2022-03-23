import type { DIDResolver } from './did/did-resolver';
import type { PermissionsRequestMessage, PermissionsMethod } from './interfaces/permissions';

import validator from './validator';

import { PermissionsRequest } from './interfaces/permissions';

export class IdentityHub {
  static methods = {
    PermissionsRequest
  };

  constructor(config: Config) {}

  /**
   * TODO: add docs
   * @param message
   */
  async processMessage(message: Message): Promise<void> {
    const { method: methodName } = message.descriptor;
    const method = IdentityHub.methods[methodName];

    if (!method) {
      throw new Error('{methodName} is not a supported method.');
    }

    const validateFn = validator.getSchema(methodName);
    const isValid = validateFn(message);

    if (!isValid) {
      // Every time a validation function is called the errors property is overwritten.
      const errors = [...validateFn.errors];

      // TODO: build helpful errors object using returned errors
      throw new Error('Invalid message.');
    }

    await method(message);
  }
};

export type Config = {
  DIDResolvers: DIDResolver[],
};

export type Message = PermissionsRequestMessage;
export type Method = PermissionsMethod;
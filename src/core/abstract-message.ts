import type { MessageInterface } from '../types/message-interface.js';
import type { GenericMessage, GenericSignaturePayload } from '../types/message-types.js';

import { Jws } from '../utils/jws.js';
import { Message } from './message.js';

/**
 * An abstract implementation of the `MessageInterface` interface.
 */
export abstract class AbstractMessage<M extends GenericMessage> implements MessageInterface<M> {
  private _message: M;
  public get message(): M {
    return this._message as M;
  }

  private _signer: string | undefined;
  public get signer(): string | undefined {
    return this._signer;
  }

  private _author: string | undefined;
  public get author(): string | undefined {
    return this._author;
  }

  private _signaturePayload: GenericSignaturePayload | undefined;
  public get signaturePayload(): GenericSignaturePayload | undefined {
    return this._signaturePayload;
  }

  protected constructor(message: M) {
    this._message = message;

    if (message.authorization !== undefined) {
      this._signer = Message.getSigner(message);

      // if the message authorization contains author delegated grant, the author would be the grantor of the grant
      // else the author would be the signer of the message
      if (message.authorization.authorDelegatedGrant !== undefined) {
        this._author = Message.getSigner(message.authorization.authorDelegatedGrant);
      } else {
        this._author = this._signer;
      }

      this._signaturePayload = Jws.decodePlainObjectPayload(message.authorization.signature);
    }
  }

  /**
   * Called by `JSON.stringify(...)` automatically.
   */
  toJSON(): GenericMessage {
    return this.message;
  }
}
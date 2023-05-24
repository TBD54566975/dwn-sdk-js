import type { SignatureInput } from '../../../jose/jws/general/types.js';
import type { ProtocolDefinition, ProtocolsConfigureDescriptor, ProtocolsConfigureMessage } from '../types.js';

import { getCurrentTimeInHighPrecision } from '../../../utils/time.js';
import { validateAuthorizationIntegrity } from '../../../core/auth.js';

import { DwnInterfaceName, DwnMethodName, Message } from '../../../core/message.js';
import { normalizeProtocolUrl, normalizeSchemaUrl, validateProtocolUrlNormalized, validateSchemaUrlNormalized } from '../../../utils/url.js';

export type ProtocolsConfigureOptions = {
  dateCreated? : string;
  definition : ProtocolDefinition;
  authorizationSignatureInput: SignatureInput;
};

export class ProtocolsConfigure extends Message<ProtocolsConfigureMessage> {

  public static async parse(message: ProtocolsConfigureMessage): Promise<ProtocolsConfigure> {
    await validateAuthorizationIntegrity(message);
    ProtocolsConfigure.validateDefinitionNormalized(message.descriptor.definition);

    return new ProtocolsConfigure(message);
  }

  public static async create(options: ProtocolsConfigureOptions): Promise<ProtocolsConfigure> {
    const descriptor: ProtocolsConfigureDescriptor = {
      interface   : DwnInterfaceName.Protocols,
      method      : DwnMethodName.Configure,
      dateCreated : options.dateCreated ?? getCurrentTimeInHighPrecision(),
      // TODO: #139 - move definition out of the descriptor - https://github.com/TBD54566975/dwn-sdk-js/issues/139
      definition  : ProtocolsConfigure.normalizeDefinition(options.definition)
    };

    const authorization = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput);
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    const protocolsConfigure = new ProtocolsConfigure(message);
    return protocolsConfigure;
  }

  private static validateDefinitionNormalized(definition: ProtocolDefinition): void {
    const { protocol, types } = definition;

    // validate protocol url
    validateProtocolUrlNormalized(protocol);

    // validate schema url normalized
    for (const typeName in types) {
      const schema = types[typeName].schema;
      if (schema !== undefined) {
        validateSchemaUrlNormalized(schema);
      }
    }
  }

  private static normalizeDefinition(definition: ProtocolDefinition): ProtocolDefinition {
    const typesCopy = { ...definition.types };

    // Normalize schema url
    for (const typeName in typesCopy) {
      const schema = typesCopy[typeName].schema;
      if (schema !== undefined) {
        typesCopy[typeName].schema = normalizeSchemaUrl(schema);
      }
    }

    return {
      ...definition,
      protocol : normalizeProtocolUrl(definition.protocol),
      types    : typesCopy,
    };
  }

  public static async getNewestMessage(messages: ProtocolsConfigureMessage[]): Promise<ProtocolsConfigureMessage | undefined> {
    let currentNewestMessage: ProtocolsConfigureMessage | undefined = undefined;
    for (const message of messages) {
      if (currentNewestMessage === undefined || await ProtocolsConfigure.isNewer(message, currentNewestMessage)) {
        currentNewestMessage = message;
      }
    }

    return currentNewestMessage;
  }

  /**
   * Checks if first message has older `dateCreated` newer than second message, using message CID comparison as tie-breaker
   * @returns `true` if `a` is newer than `b`; `false` otherwise
   */
  public static async isNewer(a: ProtocolsConfigureMessage, b: ProtocolsConfigureMessage): Promise<boolean> {
    const aIsNewer = (await ProtocolsConfigure.compareCreatedTime(a, b) > 0);
    return aIsNewer;
  }

  /**
   * Compares the `dateCreated` of the given messages with a fallback to message CID according to the spec.
   * @returns 1 if `a` is larger/newer than `b`; -1 if `a` is smaller/older than `b`; 0 otherwise (same age)
   */
  public static async compareCreatedTime(a: ProtocolsConfigureMessage, b: ProtocolsConfigureMessage): Promise<number> {
    if (a.descriptor.dateCreated > b.descriptor.dateCreated) {
      return 1;
    } else if (a.descriptor.dateCreated < b.descriptor.dateCreated) {
      return -1;
    }

    // else `dateCreated` is the same between a and b
    // compare the message CID instead, the < and > operators compare strings in lexicographical order
    return Message.compareCid(a, b);
  }
}

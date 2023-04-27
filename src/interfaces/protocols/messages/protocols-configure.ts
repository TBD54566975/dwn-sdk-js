import type { SignatureInput } from '../../../jose/jws/general/types.js';
import type { ProtocolDefinition, ProtocolsConfigureDescriptor, ProtocolsConfigureMessage } from '../types.js';

import { getCurrentTimeInHighPrecision } from '../../../utils/time.js';
import { validateAuthorizationIntegrity } from '../../../core/auth.js';

import { DwnInterfaceName, DwnMethodName, Message } from '../../../core/message.js';
import { normalizeProtocolUrl, normalizeSchemaUrl, validateProtocolUrlNormalized, validateSchemaUrlNormalized } from '../../../utils/url.js';

export type ProtocolsConfigureOptions = {
  dateCreated? : string;
  protocol: string;
  definition : ProtocolDefinition;
  authorizationSignatureInput: SignatureInput;
};

export class ProtocolsConfigure extends Message<ProtocolsConfigureMessage> {

  public static async parse(message: ProtocolsConfigureMessage): Promise<ProtocolsConfigure> {
    await validateAuthorizationIntegrity(message);
    validateProtocolUrlNormalized(message.descriptor.protocol);
    ProtocolsConfigure.validateDefinitionNormalized(message.descriptor.definition);

    return new ProtocolsConfigure(message);
  }

  public static async create(options: ProtocolsConfigureOptions): Promise<ProtocolsConfigure> {
    const descriptor: ProtocolsConfigureDescriptor = {
      interface   : DwnInterfaceName.Protocols,
      method      : DwnMethodName.Configure,
      dateCreated : options.dateCreated ?? getCurrentTimeInHighPrecision(),
      protocol    : normalizeProtocolUrl(options.protocol),
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
    // validate schema url normalized
    for (const labelKey in definition.labels) {
      const schema = definition.labels[labelKey].schema;
      validateSchemaUrlNormalized(schema);
    }
  }

  private static normalizeDefinition(definition: ProtocolDefinition): ProtocolDefinition {
    const definitionCopy = { ...definition };

    // Normalize schema url
    for (const labelKey in definition.labels) {
      definitionCopy.labels[labelKey].schema = normalizeSchemaUrl(definitionCopy.labels[labelKey].schema);
    }

    return definitionCopy;
  }
}

import type { SignatureInput } from '../../../jose/jws/general/types.js';
import type { ProtocolDefinition, ProtocolsConfigureDescriptor, ProtocolsConfigureMessage } from '../types.js';

import { getCurrentTimeInHighPrecision } from '../../../utils/time.js';
import { validateAuthorizationIntegrity } from '../../../core/auth.js';

import { DwnInterfaceName, DwnMethodName, Message } from '../../../core/message.js';
import { normalizeProtocolUri, normalizeSchemaUri, validateProtocolUriNormalized, validateSchemaUriNormalized } from '../../../utils/url.js';

export type ProtocolsConfigureOptions = {
  dateCreated? : string;
  protocol: string;
  definition : ProtocolDefinition;
  authorizationSignatureInput: SignatureInput;
};

export class ProtocolsConfigure extends Message<ProtocolsConfigureMessage> {

  public static async parse(message: ProtocolsConfigureMessage): Promise<ProtocolsConfigure> {
    await validateAuthorizationIntegrity(message);
    validateProtocolUriNormalized(message.descriptor.protocol);
    ProtocolsConfigure.validateDefinitionNormalized(message.descriptor.definition);

    return new ProtocolsConfigure(message);
  }

  public static async create(options: ProtocolsConfigureOptions): Promise<ProtocolsConfigure> {
    const descriptor: ProtocolsConfigureDescriptor = {
      interface   : DwnInterfaceName.Protocols,
      method      : DwnMethodName.Configure,
      dateCreated : options.dateCreated ?? getCurrentTimeInHighPrecision(),
      protocol    : normalizeProtocolUri(options.protocol),
      // TODO: #139 - move definition out of the descriptor - https://github.com/TBD54566975/dwn-sdk-js/issues/139
      definition  : ProtocolsConfigure.normalizeDefinition(options.definition)
    };

    Message.validateJsonSchema({ descriptor, authorization: { } });

    const authorization = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput);
    const message = { descriptor, authorization };

    const protocolsConfigure = new ProtocolsConfigure(message);
    return protocolsConfigure;
  }

  private static validateDefinitionNormalized(definition: ProtocolDefinition): void {
    // validate schema uri normalized
    for (const labelKey in definition.labels) {
      const schema = definition.labels[labelKey].schema;
      validateSchemaUriNormalized(schema);
    }
  }

  private static normalizeDefinition(definition: ProtocolDefinition): ProtocolDefinition {
    const definitionCopy = { ...definition };

    // Normalize schema uri
    for (const labelKey in definition.labels) {
      definitionCopy.labels[labelKey].schema = normalizeSchemaUri(definitionCopy.labels[labelKey].schema);
    }

    return definitionCopy;
  }
}

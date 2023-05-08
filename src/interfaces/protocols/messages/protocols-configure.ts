import type { SignatureInput } from '../../../jose/jws/general/types.js';
import type { ProtocolDefinition, ProtocolsConfigureDescriptor, ProtocolsConfigureMessage, ProtocolTypes } from '../types.js';

import { getCurrentTimeInHighPrecision } from '../../../utils/time.js';
import { validateAuthorizationIntegrity } from '../../../core/auth.js';

import { DwnInterfaceName, DwnMethodName, Message } from '../../../core/message.js';
import { normalizeProtocolUrl, normalizeSchemaUrl, validateProtocolUrlNormalized, validateSchemaUrlNormalized } from '../../../utils/url.js';

export type ProtocolsConfigureOptions = {
  dateCreated? : string;
  protocol: string;
  types: ProtocolTypes;
  definition : ProtocolDefinition;
  authorizationSignatureInput: SignatureInput;
};

export class ProtocolsConfigure extends Message<ProtocolsConfigureMessage> {

  public static async parse(message: ProtocolsConfigureMessage): Promise<ProtocolsConfigure> {
    await validateAuthorizationIntegrity(message);
    validateProtocolUrlNormalized(message.descriptor.protocol);
    ProtocolsConfigure.validateTypesNormalized(message.descriptor.types);

    return new ProtocolsConfigure(message);
  }

  public static async create(options: ProtocolsConfigureOptions): Promise<ProtocolsConfigure> {
    const descriptor: ProtocolsConfigureDescriptor = {
      interface   : DwnInterfaceName.Protocols,
      method      : DwnMethodName.Configure,
      dateCreated : options.dateCreated ?? getCurrentTimeInHighPrecision(),
      protocol    : normalizeProtocolUrl(options.protocol),
      // TODO: #139 - move definition and types out of the descriptor - https://github.com/TBD54566975/dwn-sdk-js/issues/139
      types       : ProtocolsConfigure.normalizeTypes(options.types),
      definition  : options.definition
    };

    const authorization = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput);
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    const protocolsConfigure = new ProtocolsConfigure(message);
    return protocolsConfigure;
  }

  private static validateTypesNormalized(types: ProtocolTypes): void {
    // validate schema url normalized
    for (const typeName in types) {
      const schema = types[typeName].schema;
      if (schema !== undefined) {
        validateSchemaUrlNormalized(schema);
      }
    }
  }

  private static normalizeTypes(types: ProtocolTypes): ProtocolTypes {
    const typesCopy = { ...types };

    // Normalize schema url
    for (const typeName in typesCopy) {
      const schema = typesCopy[typeName].schema;
      if (schema !== undefined) {
        typesCopy[typeName].schema = normalizeSchemaUrl(schema);
      }
    }

    return typesCopy;
  }
}

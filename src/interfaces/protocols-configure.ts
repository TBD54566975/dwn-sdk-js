import type { MessageStore } from '../types/message-store.js';
import type { SignatureInput } from '../types/jws-types.js';
import type { ProtocolDefinition, ProtocolsConfigureDescriptor, ProtocolsConfigureMessage } from '../types/protocols-types.js';

import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { GrantAuthorization } from '../core/grant-authorization.js';
import { validateAuthorizationIntegrity } from '../core/auth.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';
import { normalizeProtocolUrl, normalizeSchemaUrl, validateProtocolUrlNormalized, validateSchemaUrlNormalized } from '../utils/url.js';

export type ProtocolsConfigureOptions = {
  messageTimestamp? : string;
  definition : ProtocolDefinition;
  authorizationSignatureInput: SignatureInput;
  permissionsGrantId?: string;
};

export class ProtocolsConfigure extends Message<ProtocolsConfigureMessage> {
  // JSON Schema guarantees presence of `authorization` which contains author DID
  readonly author!: string;

  public static async parse(message: ProtocolsConfigureMessage): Promise<ProtocolsConfigure> {
    await validateAuthorizationIntegrity(message);
    ProtocolsConfigure.validateDefinitionNormalized(message.descriptor.definition);

    return new ProtocolsConfigure(message);
  }

  public static async create(options: ProtocolsConfigureOptions): Promise<ProtocolsConfigure> {
    const descriptor: ProtocolsConfigureDescriptor = {
      interface        : DwnInterfaceName.Protocols,
      method           : DwnMethodName.Configure,
      messageTimestamp : options.messageTimestamp ?? getCurrentTimeInHighPrecision(),
      definition       : ProtocolsConfigure.normalizeDefinition(options.definition)
    };

    const authorization = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput, options.permissionsGrantId);
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

  public async authorize(tenant: string, messageStore: MessageStore): Promise<void> {
    // if author is the same as the target tenant, we can directly grant access
    if (this.author === tenant) {
      return;
    } else if (this.authorizationPayload?.permissionsGrantId) {
      await GrantAuthorization.authorizeGenericMessage(tenant, this, this.author, messageStore);
    } else {
      throw new DwnError(
        DwnErrorCode.ProtocolsConfigureUnauthorized,
        'The ProtocolsConfigure failed authorization'
      );
    }
  }
}

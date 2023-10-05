import type { Signer } from '../types/signer.js';
import type { ProtocolDefinition, ProtocolRuleSet, ProtocolsConfigureDescriptor, ProtocolsConfigureMessage } from '../types/protocols-types.js';

import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { validateMessageSignatureIntegrity } from '../core/auth.js';
import { DwnError, DwnErrorCode } from '../index.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';
import { normalizeProtocolUrl, normalizeSchemaUrl, validateProtocolUrlNormalized, validateSchemaUrlNormalized } from '../utils/url.js';

export type ProtocolsConfigureOptions = {
  messageTimestamp?: string;
  definition: ProtocolDefinition;
  authorizationSigner: Signer;
  permissionsGrantId?: string;
};

export class ProtocolsConfigure extends Message<ProtocolsConfigureMessage> {
  // JSON Schema guarantees presence of `authorization` which contains author DID
  readonly author!: string;

  public static async parse(message: ProtocolsConfigureMessage): Promise<ProtocolsConfigure> {
    Message.validateJsonSchema(message);
    ProtocolsConfigure.validateProtocolDefinition(message.descriptor.definition);
    await validateMessageSignatureIntegrity(message.authorization.authorSignature, message.descriptor);

    return new ProtocolsConfigure(message);
  }

  public static async create(options: ProtocolsConfigureOptions): Promise<ProtocolsConfigure> {
    const descriptor: ProtocolsConfigureDescriptor = {
      interface        : DwnInterfaceName.Protocols,
      method           : DwnMethodName.Configure,
      messageTimestamp : options.messageTimestamp ?? getCurrentTimeInHighPrecision(),
      definition       : ProtocolsConfigure.normalizeDefinition(options.definition)
    };

    const authorization = await Message.createAuthorizationAsAuthor(
      descriptor,
      options.authorizationSigner,
      { permissionsGrantId: options.permissionsGrantId }
    );
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);
    ProtocolsConfigure.validateProtocolDefinition(message.descriptor.definition);

    const protocolsConfigure = new ProtocolsConfigure(message);
    return protocolsConfigure;
  }

  private static validateProtocolDefinition(definition: ProtocolDefinition): void {
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

    // validate `structure
    ProtocolsConfigure.validateStructure(definition);
  }

  private static validateStructure(definition: ProtocolDefinition): void {
    // gather $globalRoles
    const globalRoles: string[] = [];
    for (const rootRecordPath in definition.structure) {
      const rootRuleSet = definition.structure[rootRecordPath];
      if (rootRuleSet.$globalRole) {
        globalRoles.push(rootRecordPath);
      }
    }

    // Traverse nested rule sets
    for (const rootRecordPath in definition.structure) {
      const rootRuleSet = definition.structure[rootRecordPath];

      // gather $contextRoles
      const contextRoles: string[] = [];
      for (const childRecordType in rootRuleSet) {
        if (childRecordType.startsWith('$')) {
          continue;
        }
        const childRuleSet: ProtocolRuleSet = rootRuleSet[childRecordType];
        if (childRuleSet.$contextRole) {
          contextRoles.push(`${rootRecordPath}/${childRecordType}`);
        }
      }

      ProtocolsConfigure.validateRuleSet(rootRuleSet, rootRecordPath, [...globalRoles, ...contextRoles]);
    }
  }

  /**
   * Validates the given rule set structure then recursively validates its nested child rule sets.
   */
  private static validateRuleSet(ruleSet: ProtocolRuleSet, protocolPath: string, roles: string[]): void {
    const depth = protocolPath.split('/').length;
    if (ruleSet.$globalRole && depth !== 1) {
      throw new DwnError(
        DwnErrorCode.ProtocolsConfigureGlobalRoleAtProhibitedProtocolPath,
        `$globalRole is not allowed at protocol path (${protocolPath}). Only root records may set $globalRole true.`
      );
    } else if (ruleSet.$contextRole && depth !== 2) {
      throw new DwnError(
        DwnErrorCode.ProtocolsConfigureContextRoleAtProhibitedProtocolPath,
        `$contextRole is not allowed at protocol path (${protocolPath}). Only second-level records may set $contextRole true.`
      );
    }

    // Validate $actions in the ruleset
    const actions = ruleSet.$actions ?? [];
    for (const action of actions) {
      // Validate that all `role` properties contain protocol paths $globalRole or $contextRole records
      if (action.role !== undefined && !roles.includes(action.role)) {
        throw new DwnError(
          DwnErrorCode.ProtocolsConfigureInvalidRole,
          `Invalid role '${action.role}' found at protocol path '${protocolPath}'`
        );
      }

      // Validate that if `who` is set to `anyone` then `of` is not set
      if (action.who === 'anyone' && action.of) {
        throw new DwnError(
          DwnErrorCode.ProtocolsConfigureInvalidActionOfNotAllowed,
          `'of' is not allowed at protocol path (${protocolPath})`
        );
      }

      // Validate that if `who` is not set to `anyone` then `of` is set
      if (action.who !== undefined && ['author', 'recipient'].includes(action.who) && !action.of) {
        throw new DwnError(
          DwnErrorCode.ProtocolsConfigureInvalidActionMissingOf,
          `'of' is required at protocol path (${protocolPath})`
        );
      }
    }

    // Validate nested rule sets
    for (const recordType in ruleSet) {
      if (recordType.startsWith('$')) {
        continue;
      }
      const rootRuleSet = ruleSet[recordType];
      const nextProtocolPath = `${protocolPath}/${recordType}`;
      ProtocolsConfigure.validateRuleSet(rootRuleSet, nextProtocolPath, roles);
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
}

import type { Signer } from '../types/signer.js';
import type { ProtocolDefinition, ProtocolRuleSet, ProtocolsConfigureDescriptor, ProtocolsConfigureMessage } from '../types/protocols-types.js';

import { AbstractMessage } from '../core/abstract-message.js';
import { Message } from '../core/message.js';
import { ProtocolActor } from '../types/protocols-types.js';
import { Time } from '../utils/time.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import { normalizeProtocolUrl, normalizeSchemaUrl, validateProtocolUrlNormalized, validateSchemaUrlNormalized } from '../utils/url.js';

export type ProtocolsConfigureOptions = {
  messageTimestamp?: string;
  definition: ProtocolDefinition;
  signer: Signer;
  permissionsGrantId?: string;
};

export class ProtocolsConfigure extends AbstractMessage<ProtocolsConfigureMessage> {
  public static async parse(message: ProtocolsConfigureMessage): Promise<ProtocolsConfigure> {
    Message.validateJsonSchema(message);
    ProtocolsConfigure.validateProtocolDefinition(message.descriptor.definition);
    await Message.validateMessageSignatureIntegrity(message.authorization.signature, message.descriptor);
    Time.validateTimestamp(message.descriptor.messageTimestamp);

    return new ProtocolsConfigure(message);
  }

  public static async create(options: ProtocolsConfigureOptions): Promise<ProtocolsConfigure> {
    const descriptor: ProtocolsConfigureDescriptor = {
      interface        : DwnInterfaceName.Protocols,
      method           : DwnMethodName.Configure,
      messageTimestamp : options.messageTimestamp ?? Time.getCurrentTimestamp(),
      definition       : ProtocolsConfigure.normalizeDefinition(options.definition)
    };

    const authorization = await Message.createAuthorization({
      descriptor,
      signer             : options.signer,
      permissionsGrantId : options.permissionsGrantId
    });
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

      // Validate that if `who === recipient` and `of === undefined`, then `can` is either `delete` or `update`
      // We will not use direct recipient for `read`, `write`, or `query` because:
      // - Recipients are always allowed to `read`.
      // - `write` entails ability to create and update, whereas `update` only allows for updates.
      //    There is no 'recipient' until the record has been created, so it makes no sense to allow recipient to write.
      // - At this time, `query` is only authorized using roles, so allowing direct recipients to query is outside the scope of this PR.
      if (action.who === ProtocolActor.Recipient &&
          action.of === undefined &&
          !['update', 'delete'].includes(action.can)
      ) {
        throw new DwnError(
          DwnErrorCode.ProtocolsConfigureInvalidRecipientOfAction,
          'Rules for `recipient` without `of` property must have `can` === `delete` or `update`'
        );
      }

      // Validate that if `who` is set to `author` then `of` is set
      if (action.who === ProtocolActor.Author && !action.of) {
        throw new DwnError(
          DwnErrorCode.ProtocolsConfigureInvalidActionMissingOf,
          `'of' is required when 'author' is specified as 'who'`
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

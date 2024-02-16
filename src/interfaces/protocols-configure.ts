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
    await Message.validateSignatureStructure(message.authorization.signature, message.descriptor);
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

  /**
   * Performs validation on the given protocol definition that are not easy to do using a JSON schema.
   */
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

    // gather all declared record types
    const recordTypes = Object.keys(definition.types);

    // gather all roles
    const roles = ProtocolsConfigure.fetchAllContextRolePathsRecursively('', definition.structure, []);

    // validate the entire rule set structure recursively
    ProtocolsConfigure.validateRuleSetRecursively({
      ruleSet             : definition.structure,
      ruleSetProtocolPath : '',
      recordTypes,
      roles
    });
  }

  /**
   * Parses the given rule set hierarchy to get all the context role protocol paths.
   * @throws DwnError if the hierarchy depth goes beyond 10 levels.
   */
  private static fetchAllContextRolePathsRecursively(ruleSetProtocolPath: string, ruleSet: ProtocolRuleSet, roles: string[]): string[] {
    // Limit the depth of the record hierarchy to 10 levels
    // There is opportunity to optimize here to avoid repeated string splitting
    if (ruleSetProtocolPath.split('/').length > 10) {
      throw new DwnError(DwnErrorCode.ProtocolsConfigureRecordNestingDepthExceeded, 'Record nesting depth exceeded 10 levels.');
    }

    for (const recordType in ruleSet) {
      // ignore non-nested-record properties
      if (recordType.startsWith('$')) {
        continue;
      }

      const childRuleSet = ruleSet[recordType];

      let childRuleSetProtocolPath;
      if (ruleSetProtocolPath === '') {
        childRuleSetProtocolPath = recordType;
      } else {
        childRuleSetProtocolPath = `${ruleSetProtocolPath}/${recordType}`;
      }

      // if this is a role record, add it to the list, else continue to traverse
      if (childRuleSet.$role) {
        roles.push(childRuleSetProtocolPath);
      } else {
        ProtocolsConfigure.fetchAllContextRolePathsRecursively(childRuleSetProtocolPath, childRuleSet, roles);
      }
    }

    return roles;
  }

  /**
   * Validates the given rule set structure then recursively validates its nested child rule sets.
   */
  private static validateRuleSetRecursively(
    input: { ruleSet: ProtocolRuleSet, ruleSetProtocolPath: string, recordTypes: string[], roles: string[] }
  ): void {

    const { ruleSet, ruleSetProtocolPath, recordTypes, roles } = input;

    // Validate $actions in the rule set
    if (ruleSet.$size !== undefined) {
      const { min = 0, max } = ruleSet.$size;

      if (max !== undefined && max < min) {
        throw new DwnError(
          DwnErrorCode.ProtocolsConfigureInvalidSize,
          `Invalid size range found: max limit ${max} less than min limit ${min} at protocol path '${ruleSetProtocolPath}'`
        );
      }
    }

    // Validate $actions in the rule set
    const actions = ruleSet.$actions ?? [];
    for (const action of actions) {
      // Validate the `role` property of an `action` if exists.
      if (action.role !== undefined) {
        // make sure the role contains a valid protocol paths to a role record
        if (!roles.includes(action.role)) {
          throw new DwnError(
            DwnErrorCode.ProtocolsConfigureRoleDoesNotExistAtGivenPath,
            `Role in action ${JSON.stringify(action)} for rule set ${ruleSetProtocolPath} does not exist.`
          );
        }
      }

      // Validate that if `who` is set to `anyone` then `of` is not set
      if (action.who === 'anyone' && action.of) {
        throw new DwnError(
          DwnErrorCode.ProtocolsConfigureInvalidActionOfNotAllowed,
          `'of' is not allowed at rule set protocol path (${ruleSetProtocolPath})`
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

      if (!recordTypes.includes(recordType)) {
        throw new DwnError(
          DwnErrorCode.ProtocolsConfigureInvalidRuleSetRecordType,
          `Rule set ${recordType} is not declared as an allowed type in the protocol definition.`
        );
      }

      const childRuleSet = ruleSet[recordType];

      let childRuleSetProtocolPath;
      if (ruleSetProtocolPath === '') {
        childRuleSetProtocolPath = recordType; // case of initial definition structure
      } else {
        childRuleSetProtocolPath = `${ruleSetProtocolPath}/${recordType}`;
      }

      ProtocolsConfigure.validateRuleSetRecursively({
        ruleSet             : childRuleSet,
        ruleSetProtocolPath : childRuleSetProtocolPath,
        recordTypes,
        roles
      });
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

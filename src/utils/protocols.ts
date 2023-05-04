import type { ProtocolDefinition, ProtocolRecordDefinition } from '../interfaces/protocols/types.js';

export class Protocols {
  public static getRecordDefinition(
    protocolDefinition: ProtocolDefinition,
    recordDefinitionId: string
  ): ProtocolRecordDefinition | undefined {
    return protocolDefinition.recordDefinitions.find(({ id }) =>
      id === recordDefinitionId
    );
  }
}
import type { ProtocolDefinition, ProtocolType } from '../interfaces/protocols/types.js';

export class Protocols {
  public static getType(
    protocolDefinition: ProtocolDefinition,
    typeId: string
  ): ProtocolType | undefined {
    return protocolDefinition.types.find(({ id }) =>
      id === typeId
    );
  }
}
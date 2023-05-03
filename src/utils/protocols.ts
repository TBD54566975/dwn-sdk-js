import type { ProtocolDefinition, ProtocolRecordType } from '../interfaces/protocols/types.js';

export class Protocols {
  public static getRecordType(
    protocolDefinition: ProtocolDefinition,
    recordTypeId: string
  ): ProtocolRecordType | undefined {
    return protocolDefinition.recordTypes.find(({ id }) =>
      id === recordTypeId
    );
  }
}
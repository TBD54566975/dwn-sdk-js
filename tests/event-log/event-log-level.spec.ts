import type { Event } from '../../src/types/event-log.js';
import type { GeneratePermissionsGrantInput, GenerateProtocolsConfigureInput, GenerateRecordsWriteInput, Persona } from '../utils/test-data-generator.js';
import type { PermissionsGrant, PermissionsGrantMessage, PermissionsRevoke, ProtocolsConfigure, RecordsDelete, RecordsWrite, RecordsWriteMessage } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import { EventLogLevel } from '../../src/event-log/event-log-level.js';
import { normalizeSchemaUrl } from '../../src/utils/url.js';
import { PermissionsGrantHandler } from '../../src/handlers/permissions-grant.js';
import { PermissionsRevokeHandler } from '../../src/handlers/permissions-revoke.js';
import { ProtocolsConfigureHandler } from '../../src/handlers/protocols-configure.js';
import { RecordsDeleteHandler } from '../../src/handlers/records-delete.js';
import { RecordsWriteHandler } from '../../src/handlers/records-write.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../../src/core/message.js';

import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

let eventLog: EventLogLevel;

describe('EventLogLevel Tests', () => {
  before(async () => {
    eventLog = new EventLogLevel({ location: 'TEST-EVENTLOG' });
    await eventLog.open();
  });

  beforeEach(async () => {
    await eventLog.clear();
  });

  after(async () => {
    await eventLog.close();
  });

  it('separates events by tenant', async () => {
    const { author, message } = await TestDataGenerator.generateRecordsWrite();
    const messageCid = await Message.getCid(message);
    const watermark = await eventLog.append(author.did, messageCid);

    const { author: author2, message: message2 } = await TestDataGenerator.generateRecordsWrite();
    const messageCid2 = await Message.getCid(message2);
    const watermark2 = await eventLog.append(author2.did, messageCid2);

    let events = await eventLog.getEvents(author.did);
    expect(events.length).to.equal(1);
    expect(events[0].watermark).to.equal(watermark);
    expect(events[0].messageCid).to.equal(messageCid);

    events = await eventLog.getEvents(author2.did);
    expect(events.length).to.equal(1);
    expect(events[0].watermark).to.equal(watermark2);
    expect(events[0].messageCid).to.equal(messageCid2);
  });

  it('returns events in the order that they were appended', async () => {
    const expectedEvents: Array<Event> = [];

    const { author, message } = await TestDataGenerator.generateRecordsWrite();
    const messageCid = await Message.getCid(message);
    const watermark = await eventLog.append(author.did, messageCid);

    expectedEvents.push({ watermark, messageCid });

    for (let i = 0; i < 9; i += 1) {
      const { message } = await TestDataGenerator.generateRecordsWrite({ author });
      const messageCid = await Message.getCid(message);
      const watermark = await eventLog.append(author.did, messageCid);

      expectedEvents.push({ watermark, messageCid });
    }

    const events = await eventLog.getEvents(author.did);
    expect(events.length).to.equal(expectedEvents.length);

    for (let i = 0; i < 10; i += 1) {
      expect(events[i].watermark).to.equal(expectedEvents[i].watermark);
      expect(events[i].messageCid).to.equal(expectedEvents[i].messageCid);
    }
  });

  // describe('selective sync', () => {
  //   let author: Persona;
  //   let grantee: Persona;
  //   let proto1:string, proto2: string;
  //   let testWatermark: string;
  //   const events: Map<Event, Record<string,any>> = new Map();

  //   const addRecordsWriteEvent = async (
  //     author: Persona, options: GenerateRecordsWriteInput
  //   ): Promise<{ recordsWrite: RecordsWrite, messageCid: string, watermark: string }> => {
  //     const { message, recordsWrite } = await TestDataGenerator.generateRecordsWrite({ ...options, author });
  //     const indexes = await RecordsWriteHandler.constructIndexes(recordsWrite, true);
  //     const messageCid = await Message.getCid(message);
  //     const watermark = await eventLog.append(author.did, messageCid, indexes);

  //     return { recordsWrite, messageCid, watermark };
  //   };

  //   const addRecordsDeleteEvent = async (
  //     author: Persona, recordWrite: RecordsWriteMessage
  //   ): Promise<{ recordsDelete: RecordsDelete, messageCid: string, watermark: string }> => {
  //     const { message, recordsDelete } = await TestDataGenerator.generateRecordsDelete({ recordId: recordWrite.recordId, author });
  //     const indexes = await RecordsDeleteHandler.constructIndexes(recordsDelete);
  //     const additionalIndexes = RecordsDeleteHandler.constructAdditionalIndexes(recordWrite);
  //     const messageCid = await Message.getCid(message);
  //     const watermark = await eventLog.append(author.did, messageCid, { ...indexes, ...additionalIndexes });

  //     return { recordsDelete, messageCid, watermark };
  //   };

  //   const addProtocolsConfigureEvent = async (
  //     author: Persona, options: GenerateProtocolsConfigureInput
  //   ): Promise<{ protocolsConfigure: ProtocolsConfigure, messageCid: string, watermark: string }> => {
  //     const { message, protocolsConfigure } = await TestDataGenerator.generateProtocolsConfigure({ ...options, author });
  //     const indexes = ProtocolsConfigureHandler.constructIndexes(protocolsConfigure);
  //     const messageCid = await Message.getCid(message);
  //     const watermark = await eventLog.append(author.did, messageCid, indexes);

  //     return { protocolsConfigure, messageCid, watermark };
  //   };

  //   const addPermissionsGrant = async (
  //     options: GeneratePermissionsGrantInput
  //   ): Promise<{ permissionsGrant: PermissionsGrant, messageCid: string, watermark: string }> => {
  //     const { author } = options;
  //     const { message, permissionsGrant } = await TestDataGenerator.generatePermissionsGrant(options);
  //     const indexes = PermissionsGrantHandler.constructIndexes(permissionsGrant);
  //     const additionalIndexes = PermissionsGrantHandler.constructAdditionalIndexes(permissionsGrant);
  //     const messageCid = await Message.getCid(message);
  //     const watermark = await eventLog.append(author.did, messageCid, { ...indexes, ...additionalIndexes });
  //     return { permissionsGrant, messageCid, watermark };
  //   };

  //   const addPermissionsRevoke = async (
  //     author: Persona,
  //     grant: PermissionsGrantMessage,
  //   ): Promise<{ permissionsRevoke: PermissionsRevoke, messageCid: string, watermark: string }> => {
  //     const { permissionsRequestId: permissionsGrantId } = grant.descriptor;
  //     const { message, permissionsRevoke } = await TestDataGenerator.generatePermissionsRevoke({ author, permissionsGrantId });
  //     const indexes = PermissionsRevokeHandler.constructIndexes(permissionsRevoke);
  //     const additionalIndexes = await PermissionsRevokeHandler.constructAdditionalIndexes(grant);
  //     const messageCid = await Message.getCid(message);
  //     const watermark = await eventLog.append(author.did, messageCid, { ...indexes, ...additionalIndexes });
  //     return { permissionsRevoke, messageCid, watermark };
  //   };

  //   // initializes a set of various events for filtering returning a watermark to filter after
  //   // 11 total events
  //   // proto1 has 4 events total, 1 after the watermark
  //   // proto2 has 5 events total, 2 after the watermark
  //   // schema1 has 3 events total, 2 after the watermark
  //   // schema2 has 5 events total, 3 after the watermark
  //   // proto1 schema1 has 1 events total, 0 after the watermark
  //   // proto1 schema2 has 1 event total, 1 after the watermark
  //   // proto2 schema1 has 2 events total, 2 after the watermark
  //   // proto2 schema2 has 2 events total, 0 after the watermark
  //   const initEvents = async (): Promise<string> => {
  //     // create protocols
  //     const protoConf1 = await addProtocolsConfigureEvent(author, { published: true });
  //     events.set(protoConf1, ProtocolsConfigureHandler.constructIndexes(protoConf1.protocolsConfigure)); // proto1
  //     proto1 = protoConf1.protocolsConfigure.message.descriptor.definition.protocol;

  //     const protoConf2 = await addProtocolsConfigureEvent(author, { published: false });
  //     events.set(protoConf2, ProtocolsConfigureHandler.constructIndexes(protoConf2.protocolsConfigure)); // proto2
  //     proto2 = protoConf2.protocolsConfigure.message.descriptor.definition.protocol;

  //     // create some initial writes
  //     const write1 = await addRecordsWriteEvent(author, { schema: 'schema1', protocol: proto1, protocolPath: 'path1' });
  //     events.set(write1, await RecordsWriteHandler.constructIndexes(write1.recordsWrite, true)); // proto1 schema1
  //     const write2 = await addRecordsWriteEvent(author, { schema: 'schema2', protocol: proto2, protocolPath: 'path2' });
  //     events.set(write2, await RecordsWriteHandler.constructIndexes(write2.recordsWrite, true)); // proto2 schema2

  //     // delete write2 to show a delete event filtered by protocol
  //     const deleteForWrite2 = await addRecordsDeleteEvent(author, write2.recordsWrite.message);
  //     events.set(deleteForWrite2, {
  //       ...(await RecordsDeleteHandler.constructIndexes(deleteForWrite2.recordsDelete)),
  //       ...(RecordsDeleteHandler.constructAdditionalIndexes(write2.recordsWrite.message)),
  //     }); // proto2 schema2

  //     const grant1 = await addPermissionsGrant({
  //       author,
  //       grantedTo   : grantee.did,
  //       dateExpires : '2023-12-12T12:12:12.121212Z',
  //       scope       : { protocol: proto1, interface: DwnInterfaceName.Records, method: DwnMethodName.Read } });

  //     events.set(grant1, {
  //       ...PermissionsGrantHandler.constructIndexes(grant1.permissionsGrant),
  //       ...PermissionsGrantHandler.constructAdditionalIndexes(grant1.permissionsGrant),
  //     }); // proto1

  //     // use this watermark as a separation point in the tests
  //     const { watermark } = grant1;

  //     const grant2 = await addPermissionsGrant({
  //       author,
  //       dateExpires : '2023-12-13T12:12:12.121212Z',
  //       scope       : { schema: normalizeSchemaUrl('schema2'), interface: DwnInterfaceName.Records, method: DwnMethodName.Read }
  //     });
  //     events.set(grant2, {
  //       ...PermissionsGrantHandler.constructIndexes(grant2.permissionsGrant),
  //       ...PermissionsGrantHandler.constructAdditionalIndexes(grant2.permissionsGrant),
  //     }); // schema2

  //     const write3 = await addRecordsWriteEvent(author, { schema: 'schema1', protocol: proto2, protocolPath: 'path1' });
  //     events.set(write3, await RecordsWriteHandler.constructIndexes(write3.recordsWrite, true)); // proto2 schema1
  //     const write4 = await addRecordsWriteEvent(author, { schema: 'schema2', protocol: proto1, protocolPath: 'path2' });
  //     events.set(write4, await RecordsWriteHandler.constructIndexes(write4.recordsWrite, true)); // proto1 schema2

  //     const deleteForWrite3 = await addRecordsDeleteEvent(author, write3.recordsWrite.message);
  //     events.set(deleteForWrite3, {
  //       ...(await RecordsDeleteHandler.constructIndexes(deleteForWrite3.recordsDelete)),
  //       ...(RecordsDeleteHandler.constructAdditionalIndexes(write3.recordsWrite.message)),
  //     }); // proto2 schema1

  //     const revokeForGrant2 = await addPermissionsRevoke(author, grant2.permissionsGrant.message);
  //     events.set(revokeForGrant2, {
  //       ...PermissionsRevokeHandler.constructIndexes(revokeForGrant2.permissionsRevoke),
  //       ...(await PermissionsRevokeHandler.constructAdditionalIndexes(grant2.permissionsGrant.message))
  //     }); // schema2

  //     return watermark;
  //   };

  //   beforeEach(async () => {
  //     events.clear();
  //     author = await TestDataGenerator.generatePersona();
  //     grantee = await TestDataGenerator.generatePersona();
  //     testWatermark = await initEvents();
  //   });

  //   it('filter for events matching a protocol across all message types', async () => {
  //     // filter for proto1
  //     const proto1Events = await eventLog.query(author.did, [{ protocol: proto1 }]);
  //     expect(proto1Events.length).to.equal(4);

  //     const eventArray = [...events.keys()];
  //     const expectedProto1Events:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.protocol === proto1) {
  //         expectedProto1Events.push(e);
  //       }
  //     });

  //     expectedProto1Events.forEach(expected => {
  //       const event = proto1Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });

  //     // filter for proto2
  //     const proto2Events = await eventLog.query(author.did, [{ protocol: proto2 }]);
  //     expect(proto2Events.length).to.equal(5);

  //     const expectedProto2Events:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.protocol === proto2) {
  //         expectedProto2Events.push(e);
  //       }
  //     });

  //     expectedProto2Events.forEach(expected => {
  //       const event = proto2Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });
  //   });

  //   it('filter for events matching a protocol across all message types after a watermark', async () => {
  //     // filter for proto1
  //     const proto1Events = await eventLog.query(author.did, [{ protocol: proto1 }], testWatermark);
  //     expect(proto1Events.length).to.equal(1);

  //     // filter out anything with a smaller watermark than the test watermark
  //     const eventArray = [...events.keys()].filter(e => e.watermark > testWatermark);

  //     const expectedProto1Events:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.protocol === proto1) {
  //         expectedProto1Events.push(e);
  //       }
  //     });

  //     expectedProto1Events.forEach(expected => {
  //       const event = proto1Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });

  //     // filter for proto2
  //     const proto2Events = await eventLog.query(author.did, [{ protocol: proto2 }], testWatermark);
  //     expect(proto2Events.length).to.equal(2);

  //     const expectedProto2Events:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.protocol === proto2) {
  //         expectedProto2Events.push(e);
  //       }
  //     });

  //     expectedProto2Events.forEach(expected => {
  //       const event = proto2Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });
  //   });

  //   it('filter for events matching a schema across all message types', async () => {
  //     // filter for schema1
  //     const schema1Events = await eventLog.query(author.did, [{ schema: normalizeSchemaUrl('schema1') }]);
  //     expect(schema1Events.length).to.equal(3);

  //     const eventArray = [...events.keys()];
  //     const expectedSchema1Events:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.schema === normalizeSchemaUrl('schema1')) {
  //         expectedSchema1Events.push(e);
  //       }
  //     });

  //     expectedSchema1Events.forEach(expected => {
  //       const event = schema1Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });

  //     // filter for schema2
  //     const schema2Events = await eventLog.query(author.did, [{ schema: normalizeSchemaUrl('schema2') }]);

  //     const expectedSchema2Events:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.schema === normalizeSchemaUrl('schema2')) {
  //         expectedSchema2Events.push(e);
  //       }
  //     });

  //     expect(schema2Events.length).to.equal(5);

  //     expectedSchema2Events.forEach(expected => {
  //       const event = schema2Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });
  //   });

  //   it('filter for events matching a schema across all message types after a watermark', async () => {
  //     // filter for schema1
  //     const schema1Events = await eventLog.query(
  //       author.did,
  //       [{ schema: normalizeSchemaUrl('schema1') }],
  //       testWatermark
  //     );
  //     expect(schema1Events.length).to.equal(2);

  //     const eventArray = [...events.keys()].filter(e => e.watermark > testWatermark); // filter for newer than watermark
  //     const expectedSchema1Events:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.schema === normalizeSchemaUrl('schema1')) {
  //         expectedSchema1Events.push(e);
  //       }
  //     });

  //     expectedSchema1Events.forEach(expected => {
  //       const event = schema1Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });

  //     // filter for schema2
  //     const schema2Events = await eventLog.query(
  //       author.did,
  //       [{ schema: normalizeSchemaUrl('schema2') }],
  //       testWatermark
  //     );
  //     expect(schema2Events.length).to.equal(3);

  //     const expectedSchema2Events:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.schema === normalizeSchemaUrl('schema2')) {
  //         expectedSchema2Events.push(e);
  //       }
  //     });

  //     expectedSchema2Events.forEach(expected => {
  //       const event = schema2Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });
  //   });

  //   it('filter for events matching a protocol and schema across all message types', async () => {
  //     // filter for proto1 schema1
  //     const proto1Schema1Events = await eventLog.query(author.did, [{ protocol: proto1, schema: normalizeSchemaUrl('schema1') }]);
  //     expect(proto1Schema1Events.length).to.equal(1);

  //     const eventArray = [...events.keys()];
  //     const expectedProto1Schema1Events:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.protocol === proto1 && indexes.schema === normalizeSchemaUrl('schema1')) {
  //         expectedProto1Schema1Events.push(e);
  //       }
  //     });

  //     expectedProto1Schema1Events.forEach(expected => {
  //       const event = proto1Schema1Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });

  //     // filter for proto1 schema2
  //     const proto1Schema2Events = await eventLog.query(author.did, [{ protocol: proto1, schema: normalizeSchemaUrl('schema2') }]);
  //     expect(proto1Schema2Events.length).to.equal(1);

  //     const expectedProto1Schema2Events:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.protocol === proto1 && indexes.schema === normalizeSchemaUrl('schema2')) {
  //         expectedProto1Schema2Events.push(e);
  //       }
  //     });

  //     expectedProto1Schema2Events.forEach(expected => {
  //       const event = proto1Schema2Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });

  //     // filter for proto2 schema1
  //     const proto2Schema1Events = await eventLog.query(author.did, [{ protocol: proto2, schema: normalizeSchemaUrl('schema1') }]);
  //     expect(proto2Schema1Events.length).to.equal(2);

  //     const expectedProto2Schema1Events:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.protocol === proto2 && indexes.schema === normalizeSchemaUrl('schema1')) {
  //         expectedProto2Schema1Events.push(e);
  //       }
  //     });

  //     expectedProto2Schema1Events.forEach(expected => {
  //       const event = proto2Schema1Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });

  //     // filter for proto2 schema2
  //     const proto2Schema2Events = await eventLog.query(author.did, [{ protocol: proto2, schema: normalizeSchemaUrl('schema2') }]);
  //     expect(proto2Schema2Events.length).to.equal(2);

  //     const expectedProto2Schema2Events:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.protocol === proto2 && indexes.schema === normalizeSchemaUrl('schema2')) {
  //         expectedProto2Schema2Events.push(e);
  //       }
  //     });

  //     expectedProto2Schema2Events.forEach(expected => {
  //       const event = proto2Schema2Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });
  //   });

  //   it('filter for events matching a protocol and schema across all message types after a watermark', async () => {
  //     // filter for proto1 schema1
  //     const proto1Schema1Events = await eventLog.query(
  //       author.did,
  //       [{ protocol: proto1, schema: normalizeSchemaUrl('schema1') }],
  //       testWatermark
  //     );
  //     expect(proto1Schema1Events.length).to.equal(0);

  //     // filter for proto1 schema2
  //     const proto1Schema2Events = await eventLog.query(
  //       author.did,
  //       [{ protocol: proto1, schema: normalizeSchemaUrl('schema2') }],
  //       testWatermark
  //     );
  //     expect(proto1Schema2Events.length).to.equal(1);

  //     // filter out for higher watermark
  //     const eventArray = [...events.keys()].filter(e => e.watermark > testWatermark);

  //     const expectedProto1Schema2Events:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.protocol === proto1 && indexes.schema === normalizeSchemaUrl('schema2')) {
  //         expectedProto1Schema2Events.push(e);
  //       }
  //     });

  //     expectedProto1Schema2Events.forEach(expected => {
  //       const event = proto1Schema2Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });

  //     // filter for proto2 schema1
  //     const proto2Schema1Events = await eventLog.query(
  //       author.did,
  //       [{ protocol: proto2, schema: normalizeSchemaUrl('schema1') }],
  //       testWatermark
  //     );
  //     expect(proto2Schema1Events.length).to.equal(2);

  //     const expectedProto2Schema1Events:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.protocol === proto2 && indexes.schema === normalizeSchemaUrl('schema1')) {
  //         expectedProto2Schema1Events.push(e);
  //       }
  //     });

  //     expectedProto2Schema1Events.forEach(expected => {
  //       const event = proto2Schema1Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });

  //     // filter for proto2 schema2
  //     const proto2Schema2Events = await eventLog.query(
  //       author.did,
  //       [{ protocol: proto2, schema: normalizeSchemaUrl('schema2') }],
  //       testWatermark
  //     );
  //     expect(proto2Schema2Events.length).to.equal(0);
  //   });

  //   it('returns events from multiple filters in a single request', async () => {
  //     const protocol1And2Events = await eventLog.query(author.did, [{ protocol: proto1 }, { protocol: proto2 }]);
  //     expect(protocol1And2Events.length).to.equal(9);

  //     const eventArray = [...events.keys()];

  //     const expectedEvents:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.protocol === proto1 || indexes.protocol === proto2) {
  //         expectedEvents.push(e);
  //       }
  //     });

  //     expectedEvents.forEach(expected => {
  //       const event = protocol1And2Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });
  //   });

  //   it('returns events from multiple filters in a single request after a watermark', async () => {
  //     const protocol1And2Events = await eventLog.query(
  //       author.did,
  //       [{ protocol: proto1 }, { protocol: proto2 }],
  //       testWatermark
  //     );
  //     expect(protocol1And2Events.length).to.equal(3);

  //     // filter for events after watermark
  //     const eventArray = [...events.keys()].filter(e => e.watermark > testWatermark);

  //     const expectedEvents:Event[] = [];
  //     eventArray.forEach((e) => {
  //       const indexes = events.get(e)!;
  //       if (indexes.protocol === proto1 || indexes.protocol === proto2) {
  //         expectedEvents.push(e);
  //       }
  //     });

  //     expectedEvents.forEach(expected => {
  //       const event = protocol1And2Events.find(e => e.messageCid === expected.messageCid);
  //       expect(event?.watermark).to.equal(expected.watermark);
  //     });
  //   });
  // });

  describe('getEventsAfter', () => {
    it('gets all events for a tenant if watermark is not provided', async () => {
      const expectedEvents: Event[] = [];

      const { author, message } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await Message.getCid(message);
      const watermark = await eventLog.append(author.did, messageCid);
      expectedEvents.push({ messageCid, watermark });

      for (let i = 0; i < 9; i += 1) {
        const { message } = await TestDataGenerator.generateRecordsWrite({ author });
        const messageCid = await Message.getCid(message);

        const watermark = await eventLog.append(author.did, messageCid);
        expectedEvents.push({ messageCid, watermark });
      }

      const events = await eventLog.getEvents(author.did);
      expect(events.length).to.equal(10);

      for (let i = 0; i < events.length; i += 1) {
        expect(events[i].messageCid).to.equal(expectedEvents[i].messageCid);
        expect(events[i].watermark).to.equal(expectedEvents[i].watermark);
      }
    });

    it('gets all events that occurred after the watermark provided', async () => {
      const { author, message } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await Message.getCid(message);

      await eventLog.append(author.did, messageCid);

      const messageCids: string[] = [];
      let testWatermark = '';

      for (let i = 0; i < 9; i += 1) {
        const { message } = await TestDataGenerator.generateRecordsWrite({ author });
        const messageCid = await Message.getCid(message);

        const watermark = await eventLog.append(author.did, messageCid);

        if (i === 4) {
          testWatermark = watermark;
        }

        if (i > 4) {
          messageCids.push(messageCid);
        }
      }

      const events = await eventLog.getEvents(author.did, { gt: testWatermark });
      expect(events.length).to.equal(4);

      for (let i = 0; i < events.length; i += 1) {
        expect(events[i].messageCid).to.equal(messageCids[i], `${i}`);
      }
    });
  });

  describe('deleteEventsByCid', () => {
    it('finds and deletes events that whose values match the cids provided', async () => {
      const cids: string[] = [];
      const { author, message } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await Message.getCid(message);

      await eventLog.append(author.did, messageCid);

      for (let i = 0; i < 9; i += 1) {
        const { message } = await TestDataGenerator.generateRecordsWrite({ author });
        const messageCid = await Message.getCid(message);

        await eventLog.append(author.did, messageCid);
        if (i % 2 === 0) {
          cids.push(messageCid);
        }
      }

      const numEventsDeleted = await eventLog.deleteEventsByCid(author.did, cids);
      expect(numEventsDeleted).to.equal(cids.length);

      const remainingEvents = await eventLog.getEvents(author.did);
      expect(remainingEvents.length).to.equal(10 - cids.length);

      const cidSet = new Set(cids);
      for (const event of remainingEvents) {
        if (cidSet.has(event.messageCid)) {
          expect.fail(`${event.messageCid} should not exist`);
        }
      }
    });
  });
});
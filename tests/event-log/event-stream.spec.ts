import chaiAsPromised from 'chai-as-promised';
import { EventMessage } from '../../src/interfaces/event-create.js';
import { EventStream } from '../../src/event-log/event-stream.js';
import { EventType } from '../../src/types/event-types.js';
import type { InterfaceEventDescriptor } from '../../src/types/event-types.js';
import { Jws } from '../../src/index.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';

import chai, { assert, expect } from 'chai';
import { DwnInterfaceName, DwnMethodName } from '../../src/core/message.js';

chai.use(chaiAsPromised);

describe('Event Stream Tests', () => {
  let eventStream: EventStream;

  beforeEach(() => {
    // Create a new instance of EventStream before each test
    eventStream = new EventStream();
  });
  beforeEach(async () => {
    await eventStream.open();
  });

  afterEach(async () => {
    // Clean up after each test by closing and clearing the event stream
    await eventStream.close();
  });

  it('test add callback', async () => {
    try {
      const alice = await TestDataGenerator.generatePersona();
      let messageReceived;
      const eventHandledPromise = new Promise<void>((resolve, reject) => {
        eventStream.on(async (e: EventMessage) => {
          try {
            messageReceived = e.message.descriptor;
            resolve(); // Resolve the promise when the event is handled.
          } catch (error) {
            reject(error);
          }
        });
      });
      const msg = await EventMessage.create({
        descriptor: {
          type             : EventType.Operation,
          interface        : DwnInterfaceName.Records,
          method           : DwnMethodName.Read,
          messageTimestamp : '123',
        },
        authorizationSigner: Jws.createSigner(alice),
      });
      eventStream.add(msg); // add message
      await eventHandledPromise;
      expect(messageReceived).to.deep.equal(msg.message.descriptor);
    } catch (error) {
      assert.fail(error, undefined, 'Test failed due to an error');
    }
  });

  it('test bad message', async () => {
    const alice = await TestDataGenerator.generatePersona();

    const badMessage = await EventMessage.create({
      descriptor: {
        type             : EventType.Operation,
        messageTimestamp : '1',
      },
      authorizationSigner: Jws.createSigner(alice),
    });
    try {
      await eventStream.open();
      await eventStream.add(badMessage);
    } catch (error: any) {
      expect(error.message).to.equal('descriptor type not defined');
    }
  });

  it('should throw an error when adding events to a closed stream', async () => {
    const alice = await TestDataGenerator.generatePersona();
    const event = await EventMessage.create({
      descriptor: {
        type             : EventType.Operation,
        interface        : DwnInterfaceName.Records,
        method           : DwnMethodName.Read,
        messageTimestamp : '123',
      },
      authorizationSigner: Jws.createSigner(alice),
    });
    eventStream.close();
    // Attempt to add an event to a closed stream
    try {
      await eventStream.add(event);
    } catch (error: any) {
      expect(error.message).to.equal(
        'Event stream is not open. Cannot add to the stream.'
      );
    }
  });

  it('should handle concurrent event sending', async () => {
    const eventCount = 100; // Number of events to send concurrently
    const eventPromises = [];
    const alice = await TestDataGenerator.generatePersona();

    let caughtMessages = 0;
    const eventHandledPromise = new Promise<void>((resolve, reject) => {
      eventStream.on(async () => {
        try {
          caughtMessages += 1;
          resolve(); // Resolve the promise when the event is handled.
        } catch (error) {
          reject(error);
        }
      });
    });

    // Create an array of events to send concurrently
    const events = Array.from({ length: eventCount }, (_, i) => ({
      descriptor: {
        type             : EventType.Log,
        messageTimestamp : `${i}`,
        eventNumber      : i + 1, // Just an example property
      },
    }));

    const sendEvent = (event: EventMessage): Promise<void> => {
      return eventStream.add(event);
    };

    for (const event of events) {
      const eMsg = await EventMessage.create({
        descriptor          : event.descriptor,
        authorizationSigner : Jws.createSigner(alice),
      });
      const eventPromise = sendEvent(eMsg);
      eventPromises.push(eventPromise);
    }

    // Wait for all event sending promises to resolve
    await Promise.all(eventPromises);
    await eventHandledPromise;

    expect(caughtMessages).to.equal(eventCount);
  });

  it('test emitter chaining', async () => {
    try {
      let count = 0;
      const alice = await TestDataGenerator.generatePersona();

      const filterFunction = async (event: EventMessage): Promise<boolean> => {
        const e: InterfaceEventDescriptor = event.message.descriptor
          .eventDescriptor as unknown as InterfaceEventDescriptor;
        return e.method === DwnMethodName.Read;
      };

      const childStream = await eventStream.createChild(filterFunction);
      await childStream.open();

      const eventHandledPromise = new Promise<void>((resolve, reject) => {
        // Define the event handler function outside the setTimeout
        const eventHandler = async (): Promise<void> => {
          try {
            count += 1; // adding 1 if passes filter.
            resolve(); // Resolve the promise when the event is handled.
          } catch (error) {
            reject(error);
          }
        };
        childStream.on(eventHandler);
        setTimeout(() => {}, 500);
      });

      const msg = await EventMessage.create({
        descriptor: {
          type             : EventType.Operation,
          interface        : DwnInterfaceName.Records,
          method           : DwnMethodName.Read,
          messageTimestamp : '123',
        },
        authorizationSigner: Jws.createSigner(alice),
      });

      await eventStream.add(msg); // add message
      await eventHandledPromise;
      const msg2 = await EventMessage.create({
        descriptor: {
          type             : EventType.Operation,
          interface        : DwnInterfaceName.Records,
          method           : DwnMethodName.Write,
          messageTimestamp : '123',
        },
        authorizationSigner: Jws.createSigner(alice),
      });
      await eventStream.add(msg2); // add second message
      const msg3 = await EventMessage.create({
        descriptor: {
          type             : EventType.Operation,
          interface        : DwnInterfaceName.Records,
          method           : DwnMethodName.Read,
          messageTimestamp : '123',
        },
        authorizationSigner: Jws.createSigner(alice),
      });
      await eventStream.add(msg3); // add second message
      await eventHandledPromise;
      assert.equal(2, count, 'Wrong count. Should be 2 because of filters.');
    } catch (error) {
      assert.fail(error, undefined, 'Test failed due to an error' + error);
    } finally {
    }
  });
});

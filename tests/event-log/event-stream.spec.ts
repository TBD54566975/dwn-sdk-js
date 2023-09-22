import type { Event } from '../../src/types/event-log.js';

import chaiAsPromised from 'chai-as-promised';
import { EventStream } from '../../src/event-log/event-stream.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../../src/core/message.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import chai, { expect, assert, AssertionError } from 'chai';
import { EventDescriptor, EventMessageI, EventType } from '../../src/types/event-types.js';

chai.use(chaiAsPromised);


describe('Event Stream Tests', () => {
    let eventStream: EventStream;

    beforeEach(() => {
        // Create a new instance of EventStream before each test
        eventStream = new EventStream('testChannel');
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
            let messageReceived;
            const eventHandledPromise = new Promise<void>((resolve, reject) => {
                eventStream.on(async (e: EventMessageI<any>) => {
                    try {
                        messageReceived = e.descriptor;
                        resolve(); // Resolve the promise when the event is handled.
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            const msg = {
                descriptor: {
                    type: EventType.Operation,
                    interface: DwnInterfaceName.Records,
                    method: DwnMethodName.Read,
                    messageTimestamp: "123"
                }
            }
            eventStream.add(msg); // add message
            await eventHandledPromise;
            expect(messageReceived).to.deep.equal(msg.descriptor);
        } catch (error) {
            assert.fail(error, undefined, "Test failed due to an error");
        }
    })

    it('test bad message', async () => {
        const badMessage = {
            descriptor: {
                // Type is missing, which makes it a "bad" message
            },
        };
        try {
            await eventStream.open();
            await eventStream.add(badMessage);
            expect.fail('Expected an error to be thrown when adding a bad message.');
        } catch (error) {
            expect(error).to.be.an.instanceOf(AssertionError);
        }
    });

    it('should throw an error when adding events to a closed stream', async () => {
        const event = {
            descriptor: {
                type: EventType.Message,
                // Add necessary properties here
            },
            // Add other properties as needed
        };
        eventStream.close();
        // Attempt to add an event to a closed stream
        try {
            await eventStream.add(event);
        } catch (error: any) {
            expect(error.message).to.equal('Event stream is not open. Cannot add to the stream.');
        }
    });

    it('should handle concurrent event sending', async () => {
        const eventCount = 100; // Number of events to send concurrently
        const eventPromises = [];
        let caughtMessages = 0;
        const eventHandledPromise = new Promise<void>((resolve, reject) => {
            eventStream.on(async (e: EventMessageI<any>) => {
                try {
                    caughtMessages+=1;
                    resolve(); // Resolve the promise when the event is handled.
                } catch (error) {
                    reject(error);
                }
            });
        });

        // Create an array of events to send concurrently
        const events = Array.from({ length: eventCount }, (_, i) => ({
          descriptor: {
            type: EventType.Log,
            eventNumber: i + 1, // Just an example property
          },
        }));
      
        const sendEvent = (event: EventMessageI<any>) => {
          return eventStream.add(event);
        };
      
        for (const event of events) {
          const eventPromise = sendEvent(event);
          eventPromises.push(eventPromise);
        }
      
        // Wait for all event sending promises to resolve
        await Promise.all(eventPromises);
        await eventHandledPromise;
    
        expect(caughtMessages).to.equal(eventCount);
      });
})
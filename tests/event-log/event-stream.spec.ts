import type { Event } from '../../src/types/event-log.js';

import chaiAsPromised from 'chai-as-promised';
import { EventStream } from '../../src/event-log/event-stream.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../../src/core/message.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import chai, { expect } from 'chai';
import { MessageEventMessage } from '../../src/types/event-types.js';

chai.use(chaiAsPromised);

let eventStream: EventStream;

describe('Event Stream Tests', () => {

    before(async () => {
        eventStream = new EventStream();
        await eventStream.open();
    });

    beforeEach(async () => {
        await eventStream.clear();
    });

    after(async () => {
        await eventStream.close();
    });

    it('test add callback', async () => {
        let messageReceived; 
        const eventPromise = new Promise((resolve) => {
            eventStream.installCallback({}, async (e: MessageEventMessage) => {
              console.log("got message", e);
              messageReceived = e.descriptor;
              resolve(); // Resolve the Promise when the async function is completed
            });
          });

        // Create event
        const msg = {
            descriptor: {
                interface: DwnInterfaceName.Records,
                method: DwnMethodName.Read,
                messageTimestamp: "123" 
            }
        }
        // Check 
        eventStream.add(msg); // add message
        await eventPromise;
        expect(messageReceived).equal(msg);
    })

    it('test invalid callback with scoping', async () => {
      // TODO: Test here.  
    })

    it('test bad message', async() => {
        // TODO: Test here
    })

})
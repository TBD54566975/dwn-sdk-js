import sinon from "sinon";
import { Dwn } from "../../src/dwn.js";
import { DidResolver, MessageStore, DataStore, EventLog, DidKeyResolver, Jws, DataStream, DwnInterfaceName, DwnMethodName, Message, DwnErrorCode } from "../../src/index.js";
import { TestStores } from "../test-stores.js";
import { EventStreamI } from "../../src/event-log/event-stream.js";
import { TestDataGenerator } from "../utils/test-data-generator.js";
import { SubscriptionRequest } from "../../src/interfaces/subscription-request.js";
import { ArrayUtility } from "../../src/utils/array.js";
import { expect } from "chai";
import { EventType } from "../../src/types/event-types.js";

export function testSubscriptionRequestHandler(): void {
    describe('SubscriptionRequest.handle()', () => {
        let didResolver: DidResolver;
        let messageStore: MessageStore;
        let dataStore: DataStore;
        let eventStream: EventStreamI;
        let eventLog: EventLog;
        let dwn: Dwn;

        describe('functional tests', () => {

            // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
            // so that different test suites can reuse the same backend store for testing
            before(async () => {
                didResolver = new DidResolver([new DidKeyResolver()]);

                const stores = TestStores.get();
                messageStore = stores.messageStore;
                dataStore = stores.dataStore;
                eventLog = stores.eventLog;
                eventStream = stores.eventStream as EventStreamI;
                dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream });
            });

            beforeEach(async () => {
                sinon.restore(); // wipe all previous stubs/spies/mocks/fakes

                // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
                await messageStore.clear();
                await dataStore.clear();
                await eventLog.clear();
                await (eventStream as EventStreamI).clear();
            });

            after(async () => {
                await dwn.close();
            });

            it('should allow tenant to subscribe their own event stream', async () => {
        
                const alice = await DidKeyResolver.generate();
        
                // testing Subscription Request
                const subscriptionRequest = await SubscriptionRequest.create({
                  authorizationSignatureInput: Jws.createSignatureInput(alice)
                });
        
                const subscriptionReply = await dwn.handleSubscriptionRequest(alice.did, subscriptionRequest.message);
                expect(subscriptionReply.status.code).to.equal(200);
                expect(subscriptionReply.subscription).to.exist;
                expect(subscriptionReply.subscription?.id).to.exist;

                eventStream.on(EventType.Operation,  () => {
                    console.log("asdf");
                })

                // insert data
                const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ author: alice });
                const writeReply = await dwn.processMessage(alice.did, message, dataStream);
                expect(writeReply.status.code).to.equal(202);

                // check that subscription receieved data. 
                // should receive an processMessage event for Message write.
            })

            it('should not allow non-tenant to subscribe their an event stream', async () => {
                const alice = await DidKeyResolver.generate();

                // insert data
                const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice });
                const writeReply = await dwn.processMessage(alice.did, message, dataStream);
                expect(writeReply.status.code).to.equal(202);
        
                const bob = await DidKeyResolver.generate();
        
                const recordsRead = await SubscriptionRequest.create({
                  authorizationSignatureInput: Jws.createSignatureInput(bob)
                });

                eventStream.on(EventType.Operation,  () => {
                    console.log("asdf");
                })

            })

            it('should allow a non-tenant to read subscriptions stream access they are authorized to', async () => {
          
                const alice = await DidKeyResolver.generate();
                const bob = await DidKeyResolver.generate();

                // Alice gives Bob a PermissionsGrant with scope RecordsRead
                const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
                  author     : alice,
                  grantedBy  : alice.did,
                  grantedFor : alice.did,
                  grantedTo  : bob.did,
                  scope      : {
                    interface : DwnInterfaceName.Subscriptions,
                    method    : DwnMethodName.Request,
                  }
                });

                
                const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
                expect(permissionsGrantReply.status.code).to.equal(202);
                      
                // Alice writes a record which Bob will later try to read
                const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
                    author: alice,
                  });
                  const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, dataStream);
                  expect(recordsWriteReply.status.code).to.equal(202);
        
                // Bob tries to subscribe
                const subscriptionRequest = await SubscriptionRequest.create({
                  authorizationSignatureInput : Jws.createSignatureInput(bob),
                  permissionsGrantId          : await Message.getCid(permissionsGrant.message),
                });
                const subscriptionReply = await dwn.processMessage(alice.did, subscriptionRequest.message);
                expect(subscriptionReply.status.code).to.equal(401);
                expect(subscriptionReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationMethodMismatch);
            })

        })
    })
}
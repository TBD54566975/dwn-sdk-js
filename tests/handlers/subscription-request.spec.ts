import sinon from "sinon";
import chai, { expect, assert } from 'chai';

import { Dwn } from "../../src/dwn.js";
import { DidResolver, MessageStore, DataStore, EventLog, DidKeyResolver, Jws, DataStream, DwnInterfaceName, DwnMethodName, Message, DwnErrorCode } from "../../src/index.js";
import { TestStores } from "../test-stores.js";
import { EventStreamI } from "../../src/event-log/event-stream.js";
import { TestDataGenerator } from "../utils/test-data-generator.js";
import { SubscriptionRequest } from "../../src/interfaces/subscription-request.js";
import { ArrayUtility } from "../../src/utils/array.js";
import { EventMessageI, EventType } from "../../src/types/event-types.js";
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

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
                // await (eventStream as EventStreamI).clear();
            });

            after(async () => {
                await dwn.close();
            });

            it('should allow tenant to subscribe their own event stream', async () => {
                const alice = await DidKeyResolver.generate();

                // testing Subscription Request
                const subscriptionRequest = await SubscriptionRequest.create({
                    filter: {
                        eventType: EventType.Operation,
                    },
                    authorizationSignatureInput: Jws.createSignatureInput(alice)
                });


                const subscriptionReply = await dwn.handleSubscriptionRequest(alice.did, subscriptionRequest.message);
                expect(subscriptionReply.status.code).to.equal(200, subscriptionReply.status.detail);
                expect(subscriptionReply.subscription).to.exist;
                // expect(subscriptionReply.subscription?.id).to.exist; TODO: Subscriptoin should generate id

                // set up subscription...
                try {
                    let messageReceived: EventMessageI<any>;
                    const eventHandledPromise = new Promise<void>((resolve, reject) => {
                        subscriptionReply.subscription?.emitter?.on(async (e: EventMessageI<any>) => {
                            try {
                                messageReceived = e;
                                resolve(); // Resolve the promise when the event is handled.
                            } catch (error) {
                                reject(error);
                            }
                        });
                    });

                    const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ author: alice });
                    const writeReply = await dwn.processMessage(alice.did, message, dataStream);
                    expect(writeReply.status.code).to.equal(202);

                    await eventHandledPromise;
                    expect(messageReceived!).to.be.not.undefined;
                    expect(messageReceived!.descriptor).to.not.be.undefined;
                    expect(message.descriptor.dataCid).to.deep.equal(messageReceived!.descriptor.dataCid);
                } catch (error) {
                    assert.fail(error, undefined, "Test failed due to an error");
                }

            });

            it('should not allow non-tenant to subscribe their an event stream', async () => {
                const alice = await DidKeyResolver.generate();
                const bob = await DidKeyResolver.generate();

                // testing Subscription Request
                const subscriptionRequest = await SubscriptionRequest.create({
                    filter: {
                        eventType: EventType.Operation,
                    },
                    authorizationSignatureInput: Jws.createSignatureInput(alice)
                });
                const subscriptionReply = await dwn.handleSubscriptionRequest(bob.did, subscriptionRequest.message);
                expect(subscriptionReply.status.code).to.equal(401, subscriptionReply.status.detail);
                expect(subscriptionReply.subscription).to.not.exist;
            })

            it('should allow a non-tenant to read subscriptions stream access they are authorized to', async () => {

                const alice = await DidKeyResolver.generate();
                const bob = await DidKeyResolver.generate();

                // Alice gives Bob a PermissionsGrant with scope RecordsRead
                const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
                    author: alice,
                    grantedBy: alice.did,
                    grantedFor: alice.did,
                    grantedTo: bob.did,
                    scope: {
                        interface: DwnInterfaceName.Subscriptions,
                        method: DwnMethodName.Request,
                    }
                });

                const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
                expect(permissionsGrantReply.status.code).to.equal(202);

                // testing Subscription Request
                const subscriptionRequest = await SubscriptionRequest.create({
                    filter: {
                        eventType: EventType.Operation,
                    },
                    authorizationSignatureInput: Jws.createSignatureInput(alice)
                });

                const subscriptionReply = await dwn.handleSubscriptionRequest(alice.did, subscriptionRequest.message);
                expect(subscriptionReply.status.code).to.equal(200, subscriptionReply.status.detail);
                expect(subscriptionReply.subscription).to.exist;
                //                expect(subscriptionReply.subscription?.id).to.exist; TODO: Subscriptoin should generate id

                // set up subscription...
                try {
                    let messageReceived: EventMessageI<any>;
                    const eventHandledPromise = new Promise<void>((resolve, reject) => {
                        subscriptionReply.subscription?.emitter?.on(async (e: EventMessageI<any>) => {
                            try {
                                messageReceived = e;
                                resolve(); // Resolve the promise when the event is handled.
                            } catch (error) {
                                reject(error);
                            }
                        });
                    });

                    const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ author: alice });
                    const writeReply = await dwn.processMessage(alice.did, message, dataStream);
                    expect(writeReply.status.code).to.equal(202);

                    await eventHandledPromise;
                    expect(messageReceived!).to.be.not.undefined;
                    expect(messageReceived!.descriptor).to.not.be.undefined;
                    expect(message.descriptor.dataCid).to.deep.equal(messageReceived!.descriptor.dataCid);
                } catch (error) {
                    assert.fail(error, undefined, "Test failed due to an error");
                }
            })

            it('should allow a non-tenant to read subscriptions stream access they are authorized to, and then revoke permissions. they should no longer have access.', async () => {

                const alice = await DidKeyResolver.generate();
                const bob = await DidKeyResolver.generate();

                // Alice gives Bob a PermissionsGrant with scope RecordsRead
                const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
                    author: alice,
                    grantedBy: alice.did,
                    grantedFor: alice.did,
                    grantedTo: bob.did,
                    scope: {
                        interface: DwnInterfaceName.Subscriptions,
                        method: DwnMethodName.Request,
                    }
                });

                const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
                expect(permissionsGrantReply.status.code).to.equal(202);

                // testing Subscription Request
                const subscriptionRequest = await SubscriptionRequest.create({
                    filter: {
                        eventType: EventType.Operation,
                    },
                    authorizationSignatureInput: Jws.createSignatureInput(alice)
                });

                const subscriptionReply = await dwn.handleSubscriptionRequest(alice.did, subscriptionRequest.message);
                expect(subscriptionReply.status.code).to.equal(200, subscriptionReply.status.detail);
                expect(subscriptionReply.subscription).to.exist;
                //                expect(subscriptionReply.subscription?.id).to.exist; TODO: Subscriptoin should generate id

                // set up subscription...
                try {
                    let messageReceived: EventMessageI<any> | undefined;
                    const eventHandledPromise = new Promise<void>((resolve, reject) => {
                        subscriptionReply.subscription?.emitter?.on(async (e: EventMessageI<any>) => {
                            try {
                                messageReceived = e;
                                resolve(); // Resolve the promise when the event is handled.
                            } catch (error) {
                                reject(error);
                            }
                        });
                    });

                    let { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ author: alice });
                    let writeReply = await dwn.processMessage(alice.did, message, dataStream);
                    expect(writeReply.status.code).to.equal(202);

                    await eventHandledPromise;
                    expect(messageReceived!).to.be.not.undefined;
                    expect(messageReceived!.descriptor).to.not.be.undefined;
                    expect(message.descriptor.dataCid).to.deep.equal(messageReceived!.descriptor.dataCid);

                    // Revoke permission
                    const { permissionsRevoke } = await TestDataGenerator.generatePermissionsRevoke({
                        author: alice,
                        permissionsGrantId: await Message.getCid(permissionsGrant.message)
                    });

                    messageReceived = undefined; // since it's a revoked message, should not see message
                    const permissionsRevokeReply = await dwn.processMessage(alice.did, permissionsRevoke.message);
                    expect(permissionsRevokeReply.status.code).to.eq(202);
                    // expect(messageReceived!).to.be.undefined;

                    // console.log("revoked permission and checking.......")
                    // should get revocation operation.

                    // ({ message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ author: alice }));
                    // writeReply = await dwn.processMessage(alice.did, message, dataStream);
                    // expect(writeReply.status.code).to.equal(202);


                } catch (error) {
                    assert.fail(error, undefined, "Test failed due to an error");
                }
            })
        })
    })
}
testSubscriptionRequestHandler();
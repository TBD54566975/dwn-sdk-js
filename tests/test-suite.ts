import type { DataStore, EventLog, MessageStore, ResumableTaskStore } from '../src/index.js';

import { testAuthorDelegatedGrant } from './features/author-delegated-grant.spec.js';
import { testDwnClass } from './dwn.spec.js';
import { testEndToEndScenarios } from './scenarios/end-to-end-tests.spec.js';
import { testEventLog } from './event-log/event-log.spec.js';
import { testEventsGetHandler } from './handlers/events-get.spec.js';
import { testEventsQueryHandler } from './handlers/events-query.spec.js';
import { testEventsQueryScenarios } from './scenarios/events-query.spec.js';
import { testEventsSubscribeHandler } from './handlers/events-subscribe.spec.js';
import { testMessagesGetHandler } from './handlers/messages-get.spec.js';
import { testMessageStore } from './store/message-store.spec.js';
import { testNestedRoleScenarios } from './scenarios/nested-roles.spec.js';
import { testOwnerDelegatedGrant } from './features/owner-delegated-grant.spec.js';
import { testOwnerSignature } from './features/owner-signature.spec.js';
import { testPermissions } from './features/permissions.spec.js';
import { testProtocolCreateAction } from './features/protocol-create-action.spec.js';
import { testProtocolDeleteAction } from './features/protocol-delete-action.spec.js';
import { testProtocolsConfigureHandler } from './handlers/protocols-configure.spec.js';
import { testProtocolsQueryHandler } from './handlers/protocols-query.spec.js';
import { testProtocolUpdateAction } from './features/protocol-update-action.spec.js';
import { testRecordsDeleteHandler } from './handlers/records-delete.spec.js';
import { testRecordsPrune } from './features/records-prune.spec.js';
import { testRecordsQueryHandler } from './handlers/records-query.spec.js';
import { testRecordsReadHandler } from './handlers/records-read.spec.js';
import { testRecordsSubscribeHandler } from './handlers/records-subscribe.spec.js';
import { testRecordsTags } from './features/records-tags.spec.js';
import { testRecordsWriteHandler } from './handlers/records-write.spec.js';
import { testResumableTasks } from './features/resumable-tasks.spec.js';
import { TestStores } from './test-stores.js';
import { testSubscriptionScenarios } from './scenarios/subscriptions.spec.js';

/**
 * Class for running DWN tests from an external repository that depends on this SDK.
 */
export class TestSuite {

  /**
   * Runs tests that uses the store implementations passed.
   * Uses default implementation if not given.
   */
  public static runStoreDependentTests(overrides?: {
    messageStore?: MessageStore,
    dataStore?: DataStore,
    eventLog?: EventLog,
    resumableTaskStore?: ResumableTaskStore,
  }): void {

    before(async () => {
      TestStores.override(overrides);
    });

    testDwnClass();
    testMessageStore();
    testEventLog();

    // handler tests
    testEventsGetHandler();
    testEventsSubscribeHandler();
    testEventsQueryHandler();
    testMessagesGetHandler();
    testProtocolsConfigureHandler();
    testProtocolsQueryHandler();
    testRecordsDeleteHandler();
    testRecordsQueryHandler();
    testRecordsReadHandler();
    testRecordsSubscribeHandler();
    testRecordsWriteHandler();

    // feature tests
    testAuthorDelegatedGrant();
    testOwnerDelegatedGrant();
    testOwnerSignature();
    testPermissions();
    testProtocolCreateAction();
    testProtocolDeleteAction();
    testProtocolUpdateAction();
    testRecordsPrune();
    testRecordsTags();
    testResumableTasks();

    // scenario tests
    testEndToEndScenarios();
    testEventsQueryScenarios();
    testNestedRoleScenarios();
    testSubscriptionScenarios();
  }
}
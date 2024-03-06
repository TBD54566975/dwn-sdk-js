import type { DataStore, EventLog, MessageStore } from '../src/index.js';

import { testDelegatedGrantScenarios } from './scenarios/delegated-grant.spec.js';
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
import { testPermissionsGrantHandler } from './handlers/permissions-grant.spec.js';
import { testPermissionsRequestHandler } from './handlers/permissions-request.spec.js';
import { testProtocolCreateAction } from './features/protocol-create-action.spec.js';
import { testProtocolsConfigureHandler } from './handlers/protocols-configure.spec.js';
import { testProtocolsQueryHandler } from './handlers/protocols-query.spec.js';
import { testProtocolUpdateAction } from './features/protocol-update-action.spec.js';
import { testRecordsDeleteHandler } from './handlers/records-delete.spec.js';
import { testRecordsQueryHandler } from './handlers/records-query.spec.js';
import { testRecordsReadHandler } from './handlers/records-read.spec.js';
import { testRecordsSubscribeHandler } from './handlers/records-subscribe.spec.js';
import { testRecordsWriteHandler } from './handlers/records-write.spec.js';
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
  public static runStoreDependentTests(overrides?: { messageStore?: MessageStore, dataStore?: DataStore, eventLog?: EventLog }): void {

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
    testPermissionsGrantHandler();
    testPermissionsRequestHandler();
    testProtocolsConfigureHandler();
    testProtocolsQueryHandler();
    testRecordsDeleteHandler();
    testRecordsQueryHandler();
    testRecordsReadHandler();
    testRecordsSubscribeHandler();
    testRecordsWriteHandler();

    // feature tests
    testProtocolCreateAction();
    testProtocolUpdateAction();

    // scenario tests
    testDelegatedGrantScenarios();
    testEndToEndScenarios();
    testEventsQueryScenarios();
    testNestedRoleScenarios();
    testSubscriptionScenarios();
  }
}
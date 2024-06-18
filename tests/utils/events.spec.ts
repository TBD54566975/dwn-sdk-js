import type { EventsFilter } from '../../src/types/events-types.js';
import type { Filter } from '../../src/types/query-types.js';

import { Events } from '../../src/utils/events.js';
import { FilterUtility } from '../../src/utils/filter.js';
import { PermissionsProtocol, TestDataGenerator } from '../../src/index.js';

import sinon from 'sinon';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';


chai.use(chaiAsPromised);

describe('Events Utils', () => {

  after(() => {
    sinon.restore();
  });

  beforeEach(() => {
    sinon.restore();
  });

  describe('extractProtocolTagFilters', () => {
    it('does not apply any tag filters to non-protocol-filtered events', async () => {
      const exampleDid = 'did:example:123';
      const exampleContextId = 'abc/123';

      // contextIds are converted to range filters, so we should expect this to be converted to a range filter in the following tests
      const prefixContextIdFilter = FilterUtility.constructPrefixFilterAsRangeFilter(exampleContextId);

      const eventsFilter: EventsFilter = {
        recipient : exampleDid,
        contextId : exampleContextId
      };

      const messageFilter: Filter[] = Events.convertFilters([eventsFilter]);
      expect(messageFilter.length).to.equal(1);
      expect(messageFilter[0].recipient).to.equal(exampleDid);
      expect(messageFilter[0].contextId).to.deep.equal(prefixContextIdFilter);
    });

    it('applies appropriate tag filters to protocol-filtered events', async () => {
      // in order to filter for protocol-specific permission requests, grants and revocations we add a a protocol tag index to the message
      // when we filter for a protocol, we should add the tag filters in to accommodate for the protocol tag index

      const exampleProtocol = 'https://example.xyz/protocol/1';
      const exampleDid = 'did:example:123';
      const exampleContextId = 'abc/123';

      // contextIds are converted to range filters, so we should expect this to be converted to a range filter in the following tests
      const prefixContextIdFilter = FilterUtility.constructPrefixFilterAsRangeFilter(exampleContextId);

      // only a protocol filter is applied
      const protocolEventsFilter: EventsFilter = {
        protocol: exampleProtocol,
      };

      // here we are testing where only a protocol EventsFilter is applied
      // we should expect the EventsFilter to be split into two MessageStore Filters
      // the first filter should be the protocol tag filter applied to the permissions protocol uri
      // the second filter should be the remaining filter, only containing a protocol filter to the protocol we are targeting
      const protocolMessageFilter: Filter[] = Events.convertFilters([protocolEventsFilter]);
      expect(protocolMessageFilter.length).to.equal(2);

      const protocolTagFilter = protocolMessageFilter[0];
      // should have two filter properties: protocol tag filter and a protocol filter for the permissions protocol
      expect(Object.keys(protocolTagFilter).length).to.equal(2);
      expect(protocolTagFilter['tag.protocol']).to.equal(exampleProtocol);
      expect(protocolTagFilter.protocol).to.equal(PermissionsProtocol.uri);

      // should only have a protocol filter for the targeted protocol
      const remainingFilter = protocolMessageFilter[1];
      expect(Object.keys(remainingFilter).length).to.equal(1);
      expect(remainingFilter.protocol).to.equal(exampleProtocol);


      // with other filters in addition to the filtered protocol
      const otherEventsFilter: EventsFilter = {
        protocol  : exampleProtocol,
        recipient : exampleDid,
        contextId : exampleContextId
      };

      const messageFilter: Filter[] = Events.convertFilters([otherEventsFilter]);
      expect(messageFilter.length).to.equal(2);

      const protocolTagFilter2 = messageFilter[0];
      // should have two filter properties: protocol tag filter and a protocol filter for the permissions protocol
      expect(Object.keys(protocolTagFilter2).length).to.equal(2);
      expect(protocolTagFilter['tag.protocol']).to.equal(exampleProtocol);
      expect(protocolTagFilter.protocol).to.equal(PermissionsProtocol.uri);

      const remainingFilter2 = messageFilter[1];
      // should have the remaining filters
      expect(Object.keys(remainingFilter2).length).to.equal(3);
      expect(remainingFilter2.protocol).to.equal(exampleProtocol);
      expect(remainingFilter2.recipient).to.equal(exampleDid);
      expect(remainingFilter2.contextId).to.deep.equal(prefixContextIdFilter);
    });

    it('applies appropriate tag filters to protocol-filtered events with dateUpdated filter', async () => {
      // should apply the dateUpdated filter to the protocol tag filter

      const exampleProtocol = 'https://example.xyz/protocol/1';
      const exampleDid = 'did:example:123';
      const exampleContextId = 'abc/123';
      const dateUpdatedTimestamp = TestDataGenerator.randomTimestamp();
      const messageTimestampFilterResult = FilterUtility.convertRangeCriterion({ from: dateUpdatedTimestamp });

      // contextIds are converted to range filters, so we should expect this to be converted to a range filter in the following tests
      const prefixContextIdFilter = FilterUtility.constructPrefixFilterAsRangeFilter(exampleContextId);

      const withDateUpdatedFilter: EventsFilter = {
        protocol    : exampleProtocol,
        recipient   : exampleDid,
        contextId   : exampleContextId,
        dateUpdated : { from: dateUpdatedTimestamp }
      };

      const messageFilter: Filter[] = Events.convertFilters([withDateUpdatedFilter]);
      expect(messageFilter.length).to.equal(2);
      expect(messageFilter[0].protocol).to.equal(PermissionsProtocol.uri);
      expect(messageFilter[0]['tag.protocol']).to.equal(exampleProtocol);
      expect(messageFilter[0].messageTimestamp).to.deep.equal(messageTimestampFilterResult);


      expect(messageFilter[1].protocol).to.equal(exampleProtocol);
      expect(messageFilter[1].recipient).to.equal(exampleDid);
      expect(messageFilter[1].contextId).to.deep.equal(prefixContextIdFilter);
      expect(messageFilter[1].messageTimestamp).to.deep.equal(messageTimestampFilterResult);
    });

    it('applies appropriate tag filters to protocol-filtered events with dateCreated filter', async () => {
      // should apply the dateCreated filter to the protocol tag filter

      const exampleProtocol = 'https://example.xyz/protocol/1';
      const exampleDid = 'did:example:123';
      const exampleContextId = 'abc/123';
      const dateCreatedTimestamp = TestDataGenerator.randomTimestamp();
      const dateCreatedFilterResult = FilterUtility.convertRangeCriterion({ from: dateCreatedTimestamp });

      // contextIds are converted to range filters, so we should expect this to be converted to a range filter in the following tests
      const prefixContextIdFilter = FilterUtility.constructPrefixFilterAsRangeFilter(exampleContextId);

      const withDateCreatedFilter: EventsFilter = {
        protocol    : exampleProtocol,
        recipient   : exampleDid,
        contextId   : exampleContextId,
        dateCreated : { from: dateCreatedTimestamp }
      };

      const messageFilter: Filter[] = Events.convertFilters([withDateCreatedFilter]);
      expect(messageFilter.length).to.equal(2);
      expect(messageFilter[0].protocol).to.equal(PermissionsProtocol.uri);
      expect(messageFilter[0]['tag.protocol']).to.equal(exampleProtocol);
      expect(messageFilter[0].dateCreated).to.deep.equal(dateCreatedFilterResult);

      expect(messageFilter[1].protocol).to.equal(exampleProtocol);
      expect(messageFilter[1].recipient).to.equal(exampleDid);
      expect(messageFilter[1].contextId).to.deep.equal(prefixContextIdFilter);
      expect(messageFilter[1].dateCreated).to.deep.equal(dateCreatedFilterResult);
    });
  });
});
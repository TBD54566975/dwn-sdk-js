import type { EventsFilter } from '../../src/types/events-types.js';
import type { Filter } from '../../src/types/query-types.js';

import { Events } from '../../src/utils/events.js';
import { FilterUtility } from '../../src/utils/filter.js';
import { PermissionsProtocol } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';


chai.use(chaiAsPromised);

describe('Events Utils', () => {
  describe('converts EventFilters to MessageStore Filters', () => {
    it('applies appropriate tag filters to protocol-filtered events', async () => {
      // in order to filter for protocol-specific permission requests, grants and revocations we add a a protocol tag index to the message
      // when we filter for a protocol, we should add the tag filters in to accommodate for the protocol tag index

      const exampleProtocol = 'https://example.xyz/protocol/1';
      const exampleDid = 'did:example:123';
      const exampleContextId = 'abc/123';

      // contextIds are converted to range filters, so we should expect this to be converted to a range filter in the following tests
      const prefixContextIdFilter = FilterUtility.constructPrefixFilterAsRangeFilter(exampleContextId);

      // control case where no protocol filter is applied, so only one filter is returned
      const noProtocolEventsFilter: EventsFilter = {
        recipient : exampleDid,
        contextId : exampleContextId
      };

      const noProtocolMessageFilter: Filter[] = Events.convertFilters([noProtocolEventsFilter]);
      expect(noProtocolMessageFilter.length).to.equal(1);
      expect(noProtocolMessageFilter[0].recipient).to.equal(exampleDid);
      expect(noProtocolMessageFilter[0].contextId).to.deep.equal(prefixContextIdFilter);


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
  });
});
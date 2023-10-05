import type { RangeFilter } from '../types/message-types.js';
import type { ULIDFactory } from 'ulidx';
import type { Event, EventLog, EventsLogFilter, GetEventsOptions } from '../types/event-log.js';
import type { LevelWrapperBatchOperation, LevelWrapperIteratorOptions } from '../store/level-wrapper.js';

import { createLevelDatabase } from '../store/level-wrapper.js';
import { flatten } from '../utils/object.js';
import { IndexLevel } from '../store/index-level.js';
import { lexicographicalCompare } from '../utils/string.js';
import { monotonicFactory } from 'ulidx';
import { SortOrder } from '../types/message-types.js';

type EventLogLevelConfig = {
 /**
   * must be a directory path (relative or absolute) where
   *  LevelDB will store its files, or in browsers, the name of the
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase IDBDatabase} to be opened.
  */
  location?: string,
  createLevelDatabase?: typeof createLevelDatabase,
};

const WATERMARKS_SUBLEVEL_NAME = 'watermarks';
const CID_WATERMARKS_SUBLEVEL_NAME = 'cid_watermarks';
const CID_INDEX_SUBLEVEL_NAME = 'indexes';

export class EventLogLevel extends IndexLevel implements EventLog {
  ulidFactory: ULIDFactory;

  constructor(config?: EventLogLevelConfig) {
    const eventLogConfig = {
      location: 'EVENTLOG',
      createLevelDatabase,
      ...config,
    };
    super(eventLogConfig);

    this.ulidFactory = monotonicFactory();
  }

  /**
   * Appends messageCids to the EventLog in the order they are appended using a ulid watermark.
   * optionally add indexable properties to allow for querying filtered events.
   *
   * @param tenant
   * @param messageCid the messageCid of the message that is being appended to the log.
   * @param indexes property and value indexes to use for querying potential events.
   * @returns the ulid watermark generated during this operation.
   */
  async append(tenant: string, messageCid: string, indexes: { [key:string]: unknown } = {}): Promise<string> {
    const tenantEventLog = await this.db.partition(tenant);
    const watermarkLog = await tenantEventLog.partition(WATERMARKS_SUBLEVEL_NAME);
    const cidLog = await tenantEventLog.partition(CID_WATERMARKS_SUBLEVEL_NAME);
    const watermark = this.ulidFactory();
    await watermarkLog.put(watermark, messageCid);
    await cidLog.put(messageCid, watermark);
    await this.put(tenant, messageCid, JSON.stringify({ messageCid, watermark }), indexes, { watermark });
    return watermark;
  }

  async put(
    tenant: string,
    messageCid: string,
    value: string,
    indexes: { [key:string]: unknown },
    sortIndexes: { [key:string]: unknown }
  ): Promise<void> {
    const tenantEventLog = await this.db.partition(tenant);
    const cidIndex = await tenantEventLog.partition(CID_INDEX_SUBLEVEL_NAME);
    const indexOps: LevelWrapperBatchOperation<string>[] = [];
    indexes = flatten(indexes);
    indexOps.push({ type: 'put', key: `__${messageCid}__indexes`, value: JSON.stringify({ indexes, sortIndexes }) });
    for (const propertyName in indexes) {
      const propertyValue = indexes[propertyName];
      if (propertyValue !== undefined) {
        for (const sortProperty in sortIndexes) {
          const sortValue = sortIndexes[sortProperty];
          const key = this.constructIndexedKey(
            propertyName,
            this.encodeValue(propertyValue),
            this.encodeValue(sortValue),
            messageCid,
            `__${sortProperty}`
          );
          indexOps.push({ type: 'put', key, value });
        }
      }
    }
    await cidIndex.batch(indexOps);
  }

  /**
   * Queries Events for a given tenant using the filters provided.
   * Each filter has it's own watermark, this is to prevent returning already fetched data
   * if adding a new filter to a subsequent request.
   *
   * @param tenant
   * @param filters an array of filters that designates which event properties are being queried.
   * @returns an array of matching Events without duplicate entries between the filters.
   */
  async queryEvents(tenant: string, filters: EventsLogFilter[]): Promise<Event[]> {
    const matchedEvents: Map<string, Event> = new Map();

    await Promise.all(filters.map(f => this.executeSingleFilterQuery(tenant, f, matchedEvents)));
    return [...matchedEvents.values()];
  }

  /**
   * Gets Events for a given tenant. An optional watermark is specified to get events beyond a certain point in time.
   *
   * @param tenant
   * @param options options with that take an optional watermark.
   * @returns an array of Events for the given tenant, if a watermark is provided only Events appended after tha watermark will be returned.
   */
  async getEvents(tenant: string, options?: GetEventsOptions): Promise<Event[]> {
    const tenantEventLog = await this.db.partition(tenant);
    const watermarkLog = await tenantEventLog.partition(WATERMARKS_SUBLEVEL_NAME);
    const events: Array<Event> = [];

    for await (const [key, value] of watermarkLog.iterator(options)) {
      const event = { watermark: key, messageCid: value };
      events.push(event);
    }

    return events;
  }

  /**
   * Deletes Events associated with a given cid. Deletes any indexes that were created along with it as well.
   * @param tenant
   * @param messageCids an array of messageCids to delete.
   * @returns the number of events deleted.
   */
  async deleteEventsByCid(tenant: string, messageCids: Array<string>): Promise<number> {
    if (messageCids.length === 0) {
      return 0;
    }

    const tenantEventLog = await this.db.partition(tenant);
    const cidLog = await tenantEventLog.partition(CID_WATERMARKS_SUBLEVEL_NAME);
    const watermarkLog = await tenantEventLog.partition(WATERMARKS_SUBLEVEL_NAME);

    const ops: LevelWrapperBatchOperation<string>[] = [];
    const cidOps: LevelWrapperBatchOperation<string>[] = [];

    let numEventsDeleted = 0;
    for (const messageCid of messageCids) {
      const watermark = await cidLog.get(messageCid);
      if (watermark === undefined) {
        continue;
      }
      ops.push({ type: 'del', key: watermark });
      cidOps.push({ type: 'del', key: messageCid });
      await this.delete(tenant, messageCid);
      numEventsDeleted += 1;
    }

    await watermarkLog.batch(ops);
    return numEventsDeleted;
  }

  private async delete(tenant: string, messageCid: string): Promise<void> {
    const tenantEventLog = await this.db.partition(tenant);
    const cidIndex = await tenantEventLog.partition(CID_INDEX_SUBLEVEL_NAME);
    const indexOps: LevelWrapperBatchOperation<string>[] = [];
    const serializedIndexes = await cidIndex.get(`__${messageCid}__indexes`);
    if (serializedIndexes === undefined) {
      return;
    }
    const { indexes, sortIndexes } = JSON.parse(serializedIndexes);
    // delete all indexes associated with the data of the given ID
    for (const propertyName in indexes) {
      const propertyValue = indexes[propertyName];
      for (const sortProperty in sortIndexes) {
        const sortValue = sortIndexes[sortProperty];
        const key = this.constructIndexedKey(
          propertyName,
          this.encodeValue(propertyValue),
          this.encodeValue(sortValue),
          messageCid,
          `__${sortProperty}`
        );
        indexOps.push({ type: 'del', key });
      }
    }
    await cidIndex.batch(indexOps);
  }

  private constructIndexedKey(propertyName: string, propertyValue: string, sortValue: string, messageCid: string, prefix?: string): string {
    const keyPrefix = prefix ? [ prefix ] : [];
    const keyItems = [...keyPrefix, propertyName, propertyValue, sortValue, messageCid];
    return this.join(...keyItems);
  }

  /**
   * Executes the given single filter query and appends the results without duplicates into `matchedEvents`.
   */
  private async executeSingleFilterQuery(tenant: string, query: EventsLogFilter, matchedEvents: Map<string, Event>): Promise<void> {
    // Note: We have an array of Promises in order to support OR (anyOf) matches when given a list of accepted values for a property
    const propertyNameToPromises: { [key: string]: Promise<Event[]>[] } = {};

    const { filter, sort, sortDirection, cursor } = query;

    // Do a separate DB query for each property in `filter`
    // We will find the union of these many individual queries later.
    for (const propertyName in filter) {
      const propertyFilter = filter[propertyName];
      if (typeof propertyFilter === 'object') {
        if (Array.isArray(propertyFilter)) {
          // `propertyFilter` is a AnyOfFilter

          // Support OR matches by querying for each values separately,
          // then adding them to the promises associated with `propertyName`
          propertyNameToPromises[propertyName] = [];
          for (const propertyValue of new Set(propertyFilter)) {
            const exactMatchesPromise = this.findExactMatches(tenant, propertyName, propertyValue, sort, sortDirection, cursor);
            propertyNameToPromises[propertyName].push(exactMatchesPromise);
          }
        } else {
          // `propertyFilter` is a `RangeFilter`
          const rangeMatchesPromise = this.findRangeMatches(tenant, propertyName, propertyFilter, sort, sortDirection, cursor);
          propertyNameToPromises[propertyName] = [rangeMatchesPromise];
        }
      } else {
        // propertyFilter is an EqualFilter, meaning it is a non-object primitive type
        const exactMatchesPromise = this.findExactMatches(tenant, propertyName, propertyFilter, sort, sortDirection, cursor);
        propertyNameToPromises[propertyName] = [exactMatchesPromise];
      }
    }

    // map of ID of all data/object -> list of missing property matches
    // if count of missing property matches is 0, it means the data/object fully matches the filter
    const missingPropertyMatchesForId: { [dataId: string]: Set<string> } = { };

    // resolve promises for each property match and
    // eliminate matched property from `missingPropertyMatchesForId` iteratively to work out complete matches
    for (const [propertyName, promises] of Object.entries(propertyNameToPromises)) {
      // acting as an OR match for the property, any of the promises returning a match will be treated as a property match
      for (const promise of promises) {
        // reminder: the promise returns a list of IDs of data satisfying a particular match
        for (const event of await promise) {
          // short circuit: if a data is already included to the final matched ID set (by a different `Filter`),
          // no need to evaluate if the data satisfies this current filter being evaluated
          if (matchedEvents.has(event.messageCid)) {
            continue;
          }

          // if first time seeing a property matching for the data/object, record all properties needing a match to track progress
          missingPropertyMatchesForId[event.messageCid] ??= new Set<string>([ ...Object.keys(filter) ]);
          missingPropertyMatchesForId[event.messageCid].delete(propertyName);
          if (missingPropertyMatchesForId[event.messageCid].size === 0) {
            // full filter match, add it to return list
            matchedEvents.set(event.messageCid, event);
          }
        }
      }
    }
  }

  /**
   * @returns IDs of data that matches the exact property and value.
   */
  private async findExactMatches(
    tenant:string,
    propertyName: string,
    propertyValue: unknown,
    sortProperty: string,
    sortDirection: SortOrder,
    cursor?: string,
  ): Promise<Event[]> {
    const tenantEventLog = await this.db.partition(tenant);
    const cidIndex = await tenantEventLog.partition(CID_INDEX_SUBLEVEL_NAME);

    const prefixParts = [ `__${sortProperty}`, propertyName, this.encodeValue(propertyValue) ];
    const matchPrefix = this.join(...prefixParts, '');

    const iteratorOptions: LevelWrapperIteratorOptions<string> = {};
    if (sortDirection === SortOrder.Ascending) {
      iteratorOptions.gt = cursor ? this.join(...prefixParts, this.encodeValue(cursor)) : matchPrefix;
    } else {
      iteratorOptions.lt = cursor ? this.join(...prefixParts, this.encodeValue(cursor)) : matchPrefix;
      iteratorOptions.reverse = true;
    }

    const matches: Event[] = [];
    for await (const [ key, eventDetails ] of cidIndex.iterator(iteratorOptions)) {
      if (!key.startsWith(matchPrefix)) {
        break;
      }
      const event = this.extractEventFromValue(eventDetails);
      // do not match the cursor
      if (cursor && event.watermark === cursor) {
        continue;
      }
      matches.push(event);
    }

    if (iteratorOptions.reverse === true) {
      return matches.reverse();
    }
    return matches;
  }

  /**
   * @returns IDs of data that matches the range filter.
   */
  private async findRangeMatches(
    tenant: string,
    propertyName: string,
    rangeFilter: RangeFilter,
    sortProperty: string,
    sortDirection: SortOrder,
    cursor?: string
  ): Promise<Event[]> {
    const tenantEventLog = await this.db.partition(tenant);
    const cidIndex = await tenantEventLog.partition(CID_INDEX_SUBLEVEL_NAME);
    const iteratorOptions: LevelWrapperIteratorOptions<string> = {};
    const prefix = [ `__${sortProperty}`, propertyName ];
    const matchPrefix = this.join(...prefix, '');

    for (const comparator in rangeFilter) {
      const comparatorName = comparator as keyof RangeFilter;
      iteratorOptions[comparatorName] = this.join(...prefix, this.encodeValue(rangeFilter[comparatorName]));
    }

    // if there is no lower bound specified (`gt` or `gte`), we need to iterate from the upper bound,
    // so that we will iterate over all the matches before hitting mismatches.
    if (iteratorOptions.gt === undefined && iteratorOptions.gte === undefined) {
      iteratorOptions.reverse = true;
    }

    const matches: Event[] = [];
    for await (const [ key, eventDetails ] of cidIndex.iterator(iteratorOptions)) {
      // if "greater-than" is specified, skip all keys that contains the exact value given in the "greater-than" condition
      if ('gt' in rangeFilter && this.extractRangeValueFromKey(key) === this.encodeValue(rangeFilter.gt)) {
        continue;
      }

      // immediately stop if we arrive at an index entry for a different property
      if (!key.startsWith(matchPrefix)) {
        break;
      }

      const event = this.extractEventFromValue(eventDetails);

      // do not match the cursor
      if (cursor && event.watermark === cursor) {
        continue;
      }

      matches.push(event);
    }

    if ('lte' in rangeFilter) {
      // When `lte` is used, we must also query the exact match explicitly because the exact match will not be included in the iterator above.
      // This is due to the extra data (watermark) appended to the (property + value) key prefix, e.g.
      // key = 'dateCreated\u0000"2023-05-25T11:22:33.000000Z"\u000001HBY2E1TPY1W95SE0PEG2AM96'
      // the value would be considered greater than { lte: `dateCreated\u0000"2023-05-25T11:22:33.000000Z"` } used in the iterator options,
      // thus would not be included in the iterator even though we'd like it to be.
      for (const event of await this.findExactMatches(tenant, propertyName, rangeFilter.lte, sortProperty, sortDirection, cursor)) {
        matches.push(event);
      }
    }

    // if we iterated in reverse the results are reversed as well.
    if (iteratorOptions.reverse === true) {
      matches.reverse();
    }

    return matches.sort((a,b) => lexicographicalCompare(a.watermark, b.watermark));
  }

  /**
   * Extracts the value encoded within the range index key when an event is inserted.
   *
   * ex. key: 'dateCreated\u0000"2023-05-25T18:23:29.425008Z"\u000....'
   *     extracted value: "2023-05-25T18:23:29.425008Z"
   *
   * @param key an EventLogLevel db key.
   * @returns the extracted encodedValue from the key.
   */
  private extractRangeValueFromKey(key: string): string {
    const [,,value] = key.split(EventLogLevel.delimiter);
    return value;
  }

  /**
   * Extracts the Event object from the given db value.
   *
   * ex. value: 'bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry\u000001HBY2E1TPY1W95SE0PEG2AM96'
   *     extracted: Event : {
   *                  messageCid : 'bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry',
   *                  watermark  : '01HBY2E1TPY1W95SE0PEG2AM96'
   *                }
   *
   * @param value an EventLogLevel db value.
   * @returns a parsed Event object or undefined if invalid.
   */
  private extractEventFromValue(value: string): Event {
    return JSON.parse(value);
  }
}
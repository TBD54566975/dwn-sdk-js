import type { Filter } from '../types/message-types.js';
import type { RangeFilter } from '../types/message-types.js';
import type { ULIDFactory } from 'ulidx';
import type { Event, EventLog, EventsLogFilter, GetEventsOptions } from '../types/event-log.js';
import type { LevelWrapperBatchOperation, LevelWrapperIteratorOptions } from '../store/level-wrapper.js';

import { createLevelDatabase } from '../store/level-wrapper.js';
import { flatten } from '../utils/object.js';
import { IndexLevel } from '../store/index-level.js';
import { lexicographicalCompare } from '../utils/string.js';
import { monotonicFactory } from 'ulidx';

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
const INDEXS_SUBLEVEL_NAME = 'indexes';

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
  async append(tenant: string, messageCid: string, indexes: { [key:string]:unknown } = {}): Promise<string> {
    const tenantEventLog = await this.db.partition(tenant);
    const watermarkLog = await tenantEventLog.partition(WATERMARKS_SUBLEVEL_NAME);
    const cidIndex = await tenantEventLog.partition(INDEXS_SUBLEVEL_NAME);
    const watermark = this.ulidFactory();

    const indexOps: LevelWrapperBatchOperation<string>[] = [];
    if (indexes !== undefined) {
      indexes = flatten(indexes);
      indexOps.push({ type: 'put', key: `__${messageCid}__indexes`, value: JSON.stringify({ indexes, watermark }) });

      for (const propertyName in indexes) {
        const propertyValue = indexes[propertyName];
        if (propertyValue !== undefined) {
          const key = this.join(propertyName, this.encodeValue(propertyValue), watermark);
          const value = `${messageCid}~${watermark}`;
          indexOps.push({ type: 'put', key, value });
        }
      }
    }

    await cidIndex.batch(indexOps);
    await watermarkLog.put(watermark, messageCid);

    return watermark;
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

    await Promise.all(filters.map(f => this.executeSingleFilterQuery(tenant, f.filter, matchedEvents, f.gt)));
    return this.sortEvents([...matchedEvents.values()]);
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
   * @param cids an array of messageCids to delete.
   * @returns the number of events deleted.
   */
  async deleteEventsByCid(tenant: string, cids: Array<string>): Promise<number> {
    if (cids.length === 0) {
      return 0;
    }

    const tenantEventLog = await this.db.partition(tenant);
    const cidIndex = await tenantEventLog.partition(INDEXS_SUBLEVEL_NAME);
    const watermarkLog = await tenantEventLog.partition(WATERMARKS_SUBLEVEL_NAME);

    const ops: LevelWrapperBatchOperation<string>[] = [];
    const indexOps: LevelWrapperBatchOperation<string>[] = [];

    let numEventsDeleted = 0;
    for (const cid of cids) {
      console.log('getting cid', cid);
      const serializedIndexes = await cidIndex.get(`__${cid}__indexes`);
      if (serializedIndexes === undefined) {
        continue;
      }
      console.log('testing here', serializedIndexes);
      const { indexes, watermark } = JSON.parse(serializedIndexes);
      console.log('and here', { indexes, watermark });
      ops.push({ type: 'del', key: watermark });
      numEventsDeleted += 1;
      // delete all indexes associated with the data of the given ID
      for (const propertyName in indexes) {
        const propertyValue = indexes[propertyName];
        const key = this.join(propertyName, this.encodeValue(propertyValue), cid);
        indexOps.push({ type: 'del', key });
      }
    }

    await cidIndex.batch(indexOps);
    await watermarkLog.batch(ops);

    return numEventsDeleted;
  }

  /**
   * Executes the given single filter query and appends the results without duplicates into `matchedEvents`.
   */
  private async executeSingleFilterQuery(tenant: string, filter: Filter, matchedEvents: Map<string, Event>, watermark?: string): Promise<void> {
    // Note: We have an array of Promises in order to support OR (anyOf) matches when given a list of accepted values for a property
    const propertyNameToPromises: { [key: string]: Promise<Event[]>[] } = {};

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
            const exactMatchesPromise = this.findExactMatches(tenant, propertyName, propertyValue, watermark);
            propertyNameToPromises[propertyName].push(exactMatchesPromise);
          }
        } else {
          // `propertyFilter` is a `RangeFilter`
          const rangeMatchesPromise = this.findRangeMatches(tenant, propertyName, propertyFilter, watermark);
          propertyNameToPromises[propertyName] = [rangeMatchesPromise];
        }
      } else {
        // propertyFilter is an EqualFilter, meaning it is a non-object primitive type
        const exactMatchesPromise = this.findExactMatches(tenant, propertyName, propertyFilter, watermark);
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
  private async findExactMatches(tenant:string, propertyName: string, propertyValue: unknown, watermark?: string): Promise<Event[]> {
    const tenantEventLog = await this.db.partition(tenant);
    const cidIndex = await tenantEventLog.partition(INDEXS_SUBLEVEL_NAME);
    const prefixProperties = [ propertyName, this.encodeValue(propertyValue) ];
    const propertyValuePrefix = this.join(...prefixProperties, '');

    const iteratorOptions: LevelWrapperIteratorOptions<string> = {
      gt: propertyValuePrefix
    };

    const matches: Event[] = [];
    for await (const [ key, watermarkValue ] of cidIndex.iterator(iteratorOptions)) {
      if (!key.startsWith(propertyValuePrefix)) {
        break;
      }

      const event = this.extractEventFromValue(watermarkValue);
      if (event === undefined) {
        break; // throw?
      }

      // skip events prior to the watermark.
      if (watermark !== undefined && watermark >= event.watermark) {
        continue;
      }

      matches.push(event);
    }

    return matches;
  }

  /**
   * @returns IDs of data that matches the range filter.
   */
  private async findRangeMatches(tenant: string, propertyName: string, rangeFilter: RangeFilter, watermark?: string): Promise<Event[]> {
    const tenantEventLog = await this.db.partition(tenant);
    const cidIndex = await tenantEventLog.partition(INDEXS_SUBLEVEL_NAME);
    const iteratorOptions: LevelWrapperIteratorOptions<string> = {};

    for (const comparator in rangeFilter) {
      const comparatorName = comparator as keyof RangeFilter;
      iteratorOptions[comparatorName] = this.join(propertyName, this.encodeValue(rangeFilter[comparatorName]));
    }

    // if there is no lower bound specified (`gt` or `gte`), we need to iterate from the upper bound,
    // so that we will iterate over all the matches before hitting mismatches.
    if (iteratorOptions.gt === undefined && iteratorOptions.gte === undefined) {
      iteratorOptions.reverse = true;
    }

    const matches: Event[] = [];
    for await (const [ key, watermarkValue ] of cidIndex.iterator(iteratorOptions)) {
      // if "greater-than" is specified, skip all keys that contains the exact value given in the "greater-than" condition
      if ('gt' in rangeFilter && EventLogLevel.extractValueFromKey(key) === this.encodeValue(rangeFilter.gt)) {
        continue;
      }

      // immediately stop if we arrive at an index entry for a different property
      if (!key.startsWith(propertyName)) {
        break;
      }

      const event = this.extractEventFromValue(watermarkValue);
      if (event === undefined) {
        break; // throw?
      }

      // skip events prior to the watermark.
      if (watermark && watermark >= event.watermark) {
        continue;
      }

      matches.push(event);
    }

    if ('lte' in rangeFilter) {
      // When `lte` is used, we must also query the exact match explicitly because the exact match will not be included in the iterator above.
      // This is due to the extra data (CID) appended to the (property + value) key prefix, e.g.
      // key = 'dateCreated\u0000"2023-05-25T11:22:33.000000Z"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // the value would be considered greater than { lte: `dateCreated\u0000"2023-05-25T11:22:33.000000Z"` } used in the iterator options,
      // thus would not be included in the iterator even though we'd like it to be.
      for (const event of await this.findExactMatches(tenant, propertyName, rangeFilter.lte, watermark)) {
        matches.push(event);
      }
    }

    // if we iterated in reverse the results are reversed as well.
    if (iteratorOptions.reverse === true) {
      matches.reverse();
    }
    return matches;
  }

  /**
   *  Encodes a numerical value as a string for lexicographical comparison.
   *  If the number is positive it simply pads it with leading zeros.
   *  ex.: input:  1024 => "0000000000001024"
   *       input: -1024 => "!9007199254739967"
   *
   * @param value the number to encode.
   * @returns a string representation of the number.
   */
  static encodeNumberValue(value: number): string {
    const NEGATIVE_OFFSET = Number.MAX_SAFE_INTEGER;
    const NEGATIVE_PREFIX = '!'; // this will be sorted below positive numbers lexicographically
    const PADDING_LENGTH = String(Number.MAX_SAFE_INTEGER).length;

    const prefix: string = value < 0 ? NEGATIVE_PREFIX : '';
    const offset: number = value < 0 ? NEGATIVE_OFFSET : 0;
    return prefix + String(value + offset).padStart(PADDING_LENGTH, '0');
  }

  /**
   * Extracts the value encoded within the indexed key when a record is inserted.
   *
   * ex. key: 'dateCreated\u0000"2023-05-25T18:23:29.425008Z"\u000001HBY2E1TPY1W95SE0PEG2AM96'
   *     extracted value: "2023-05-25T18:23:29.425008Z"
   *
   * @param key an EventLogLevel db key.
   * @returns the extracted encodedValue from the key.
   */
  static extractValueFromKey(key: string): string {
    const [, value] = key.split(this.delimiter);
    return value;
  }

  /**
   * Extracts the Event object from the given db value.
   *
   * @param value an EventLogLevel db value.
   * @returns
   */
  private extractEventFromValue(value: string): Event|undefined {
    const [ messageCid, watermark ] = value.split('~');
    if (messageCid === undefined || watermark === undefined) {
      return undefined;
    }
    return { messageCid, watermark };
  }

  /**
   * Sorts events queried based on watermark.
   * @param events incoming events from query filters.
   * @returns {Event[]} sorted events by watermark ascending.
   */
  private sortEvents(events: Event[]): Event[] {
    return events.sort((a,b) => lexicographicalCompare(a.watermark, b.watermark));
  }
}
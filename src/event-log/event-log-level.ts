import type { Filter } from '../types/message-types.js';
import type { RangeFilter } from '../types/message-types.js';
import type { ULIDFactory } from 'ulidx';
import type { Event, EventLog, GetEventsOptions } from '../types/event-log.js';
import type { LevelWrapperBatchOperation, LevelWrapperIteratorOptions } from '../store/level-wrapper.js';

import { flatten } from '../utils/object.js';
import { monotonicFactory } from 'ulidx';
import { createLevelDatabase, LevelWrapper } from '../store/level-wrapper.js';

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
const CIDS_SUBLEVEL_NAME = 'cids';
const INDEXS_SUBLEVEL_NAME = 'indexes';

export class EventLogLevel implements EventLog {
  config: EventLogLevelConfig;
  db: LevelWrapper<string>;
  ulidFactory: ULIDFactory;

  constructor(config?: EventLogLevelConfig) {
    this.config = {
      location: 'EVENTLOG',
      createLevelDatabase,
      ...config,
    };

    this.db = new LevelWrapper<string>({
      location            : this.config.location!,
      createLevelDatabase : this.config.createLevelDatabase,
      valueEncoding       : 'utf8',
    });
    this.ulidFactory = monotonicFactory();
  }

  async open(): Promise<void> {
    return this.db.open();
  }

  async close(): Promise<void> {
    return this.db.close();
  }

  async clear(): Promise<void> {
    return this.db.clear();
  }

  async append(tenant: string, messageCid: string, indexes?: { [key:string]:unknown }): Promise<string> {
    const tenantEventLog = await this.db.partition(tenant);
    const watermarkLog = await tenantEventLog.partition(WATERMARKS_SUBLEVEL_NAME);
    const cidLog = await tenantEventLog.partition(CIDS_SUBLEVEL_NAME);
    const cidIndex = await tenantEventLog.partition(INDEXS_SUBLEVEL_NAME);
    const watermark = this.ulidFactory();

    const indexOps: LevelWrapperBatchOperation<string>[] = [];
    if (indexes !== undefined) {
      indexes = flatten(indexes);
      for (const propertyName in indexes) {
        const propertyValue = indexes[propertyName];
        if (propertyValue !== undefined) {
          const key = this.join(propertyName, this.encodeValue(propertyValue), watermark, messageCid);
          const value = `${messageCid}~${watermark}`;
          indexOps.push({ type: 'put', key, value });
        }
      }
      indexOps.push({ type: 'put', key: `__${messageCid}__indexes`, value: JSON.stringify(indexes) });
    }

    await watermarkLog.put(watermark, messageCid);
    await cidLog.put(messageCid, watermark);
    await cidIndex.batch(indexOps);

    return watermark;
  }

  /**
   * Executes the given single filter query and appends the results without duplicate into `matchedIDs`.
   */
  private async executeSingleFilterQuery(tenant: string, filter: Filter, matchedEvents: Map<string, Event>, watermark?: string): Promise<void> {
    // Note: We have an array of Promises in order to support OR (anyOf) matches when given a list of accepted values for a property
    const propertyNameToPromises: { [key: string]: Promise<string[]>[] } = {};

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
        for (const watermarkData of await promise) {
          const [ messageCid, watermark ] = watermarkData.split('~');
          if (messageCid === undefined || watermark === undefined) {
            continue;
          }

          // short circuit: if a data is already included to the final matched ID set (by a different `Filter`),
          // no need to evaluate if the data satisfies this current filter being evaluated
          if (matchedEvents.has(messageCid)) {
            continue;
          }

          // if first time seeing a property matching for the data/object, record all properties needing a match to track progress
          missingPropertyMatchesForId[watermarkData] ??= new Set<string>([ ...Object.keys(filter) ]);
          missingPropertyMatchesForId[watermarkData].delete(propertyName);
          if (missingPropertyMatchesForId[watermarkData].size === 0) {
            // full filter match, add it to return list
            matchedEvents.set(messageCid, { messageCid, watermark });
          }
        }
      }
    }
  }

  /**
   * @returns IDs of data that matches the exact property and value.
   */
  private async findExactMatches(tenant:string, propertyName: string, propertyValue: unknown, watermark?: string): Promise<string[]> {
    const tenantEventLog = await this.db.partition(tenant);
    const cidIndex = await tenantEventLog.partition(INDEXS_SUBLEVEL_NAME);
    const prefixProperties = [ propertyName, this.encodeValue(propertyValue) ];
    const propertyValuePrefix = this.join(...prefixProperties, '');

    const iteratorOptions: LevelWrapperIteratorOptions<string> = {};
    if (watermark) {
      prefixProperties.push(watermark);
      iteratorOptions.gt = this.join(...prefixProperties, '');
    } else {
      iteratorOptions.gt = propertyValuePrefix;
    }



    const matches: string[] = [];
    for await (const [ key, watermarkValue ] of cidIndex.iterator(iteratorOptions)) {
      if (!key.startsWith(propertyValuePrefix)) {
        break;
      }
      // don't match exact watermark
      if (watermark && key.includes(watermark)) {
        continue;
      }

      matches.push(watermarkValue);
    }
    return matches;
  }

  async query(tenant: string, filters: Filter[], watermark?: string): Promise<Event[]> {
    const matchedEvents: Map<string, Event> = new Map();

    await Promise.all(filters.map(f => this.executeSingleFilterQuery(tenant, f, matchedEvents, watermark)));
    return [...matchedEvents.values()];
  }

  /**
   * @returns IDs of data that matches the range filter.
   */
  private async findRangeMatches(tenant: string, propertyName: string, rangeFilter: RangeFilter, watermark?: string): Promise<string[]> {
    const tenantEventLog = await this.db.partition(tenant);
    const cidIndex = await tenantEventLog.partition(INDEXS_SUBLEVEL_NAME);
    const iteratorOptions: LevelWrapperIteratorOptions<string> = {};

    for (const comparator in rangeFilter) {
      const comparatorName = comparator as keyof RangeFilter;
      const prefixProperties = [ propertyName, this.encodeValue(rangeFilter[comparatorName]) ];
      if (watermark) {
        prefixProperties.push(watermark);
      }
      iteratorOptions[comparatorName] = this.join(...prefixProperties);
    }

    // if there is no lower bound specified (`gt` or `gte`), we need to iterate from the upper bound,
    // so that we will iterate over all the matches before hitting mismatches.
    if (iteratorOptions.gt === undefined && iteratorOptions.gte === undefined) {
      iteratorOptions.reverse = true;
    }

    const matches: string[] = [];
    for await (const [ key, dataId ] of cidIndex.iterator(iteratorOptions)) {
      // if "greater-than" is specified, skip all keys that contains the exact value given in the "greater-than" condition
      if ('gt' in rangeFilter && EventLogLevel.extractValueFromKey(key) === this.encodeValue(rangeFilter.gt)) {
        continue;
      }

      // immediately stop if we arrive at an index entry for a different property
      if (!key.startsWith(propertyName)) {
        break;
      }

      matches.push(dataId);
    }

    if ('lte' in rangeFilter) {
      // When `lte` is used, we must also query the exact match explicitly because the exact match will not be included in the iterator above.
      // This is due to the extra data (CID) appended to the (property + value) key prefix, e.g.
      // key = 'dateCreated\u0000"2023-05-25T11:22:33.000000Z"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // the value would be considered greater than { lte: `dateCreated\u0000"2023-05-25T11:22:33.000000Z"` } used in the iterator options,
      // thus would not be included in the iterator even though we'd like it to be.
      for (const dataId of await this.findExactMatches(tenant, propertyName, rangeFilter.lte, watermark)) {
        matches.push(dataId);
      }
    }

    return matches;
  }

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

  async deleteEventsByCid(tenant: string, cids: Array<string>): Promise<number> {
    if (cids.length === 0) {
      return 0;
    }

    const tenantEventLog = await this.db.partition(tenant);
    const cidLog = await tenantEventLog.partition(CIDS_SUBLEVEL_NAME);
    const cidIndex = await tenantEventLog.partition(INDEXS_SUBLEVEL_NAME);

    let ops: LevelWrapperBatchOperation<string>[] = [];
    const indexOps: LevelWrapperBatchOperation<string>[] = [];
    const promises: Array<Promise<string | undefined>> = [];

    for (const cid of cids) {
      ops.push({ type: 'del', key: cid });
      const promise = cidLog.get(cid).catch(e => e);
      promises.push(promise);

      const serializedIndexes = await cidIndex.get(`__${cid}__indexes`);
      if (serializedIndexes === undefined) {
        continue;
      }
      const indexes = JSON.parse(serializedIndexes);
      // delete all indexes associated with the data of the given ID
      for (const propertyName in indexes) {
        const propertyValue = indexes[propertyName];
        const key = this.join(propertyName, this.encodeValue(propertyValue), cid);
        indexOps.push({ type: 'del', key });
      }
    }

    await cidLog.batch(ops);
    await cidIndex.batch(indexOps);

    ops = [];
    let numEventsDeleted = 0;

    const watermarks: Array<string | undefined> = await Promise.all(promises);
    for (const watermark of watermarks) {
      if (watermark) {
        ops.push({ type: 'del', key: watermark });
        numEventsDeleted += 1;
      }
    }

    const watermarkLog = await tenantEventLog.partition(WATERMARKS_SUBLEVEL_NAME);
    await watermarkLog.batch(ops);
    return numEventsDeleted;
  }

  /**
 * Joins the given values using the `\x00` (\u0000) character.
 */
  private static delimiter = `\x00`;
  private join(...values: unknown[]): string {
    return values.join(EventLogLevel.delimiter);
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
   * ex. key: 'dateCreated\u0000"2023-05-25T18:23:29.425008Z"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
   *     extracted value: "2023-05-25T18:23:29.425008Z"
   *
   * @param key an IndexLevel db key.
   * @returns the extracted encodedValue from the key.
   */
  static extractValueFromKey(key: string): string {
    const [, value] = key.split(this.delimiter);
    return value;
  }

  private encodeValue(value: unknown): string {
    switch (typeof value) {
    case 'string':
      // We can't just `JSON.stringify` as that'll affect the sort order of strings.
      // For example, `'\x00'` becomes `'\\u0000'`.
      return `"${value}"`;
    case 'number':
      return EventLogLevel.encodeNumberValue(value);
    default:
      return String(value);
    }
  }
}
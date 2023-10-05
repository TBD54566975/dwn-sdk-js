import type { Filter, RangeFilter } from '../types/message-types.js';
import type { LevelWrapperBatchOperation, LevelWrapperIteratorOptions } from './level-wrapper.js';

import { executeUnlessAborted } from '../utils/abort.js';
import { flatten } from '../utils/object.js';
import { lexicographicalCompare } from '../utils/string.js';
import { SortOrder } from '../types/message-types.js';
import { createLevelDatabase, LevelWrapper } from './level-wrapper.js';

export interface IndexLevelOptions {
  signal?: AbortSignal;
}

type SortableValue = {
  value: string;
  sortValue: string;
};

type FilteredQuery = {
  filter: Filter
  sort: string
  sortDirection: SortOrder
  cursor?: string
};

const INDEX_SUBLEVEL_NAME = 'index';

/**
 * IndexLevel is a base class with some common functions used between MessageIndex and EventLog.
 */
export class IndexLevel {
  db: LevelWrapper<string>;
  constructor(private config: IndexLevelConfig) {
    this.db = new LevelWrapper<string>({ ...this.config, valueEncoding: 'utf8' });
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

  protected async index(
    tenant: string,
    messageCid: string,
    value: unknown,
    indexes: { [key:string]: unknown },
    sortIndexes: { [key:string]: unknown }
  ): Promise<void> {
    const tenantEventLog = await this.db.partition(tenant);
    const cidIndex = await tenantEventLog.partition(INDEX_SUBLEVEL_NAME);
    const indexOps: LevelWrapperBatchOperation<string>[] = [];
    indexes = flatten(indexes);
    indexOps.push({ type: 'put', key: `__${messageCid}__indexes`, value: JSON.stringify({ indexes, sortIndexes }) });
    for (const propertyName in indexes) {
      const propertyValue = indexes[propertyName];
      if (propertyValue !== undefined) {
        for (const sortProperty in sortIndexes) {
          const sortValue = sortIndexes[sortProperty];
          const key = this.constructIndexedKey(
            `__${sortProperty}`,
            propertyName,
            this.encodeValue(propertyValue),
            this.encodeValue(sortValue),
            messageCid,
          );
          indexOps.push({ type: 'put', key, value: JSON.stringify(value) });
        }
      }
    }
    await cidIndex.batch(indexOps);
  }

  protected async purge(tenant: string, messageCid: string): Promise<void> {
    const tenantEventLog = await this.db.partition(tenant);
    const cidIndex = await tenantEventLog.partition(INDEX_SUBLEVEL_NAME);
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
          `__${sortProperty}`,
          propertyName,
          this.encodeValue(propertyValue),
          this.encodeValue(sortValue),
          messageCid,
        );
        indexOps.push({ type: 'del', key });
      }
    }
    await cidIndex.batch(indexOps);
  }

  protected constructIndexedKey(prefix: string, propertyName: string, propertyValue: string, sortValue: string, messageCid: string): string {
    return this.join(prefix, propertyName, propertyValue, sortValue, messageCid);
  }

  protected async executeSingleFilterQuery(tenant: string, query: FilteredQuery, matchedEvents: Map<string, string>): Promise<void> {
    // Note: We have an array of Promises in order to support OR (anyOf) matches when given a list of accepted values for a property
    const propertyNameToPromises: { [key: string]: Promise<SortableValue[]>[] } = {};

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
        for (const sortableValue of await promise) {
          // short circuit: if a data is already included to the final matched ID set (by a different `Filter`),
          // no need to evaluate if the data satisfies this current filter being evaluated
          if (matchedEvents.has(sortableValue.value)) {
            continue;
          }

          // if first time seeing a property matching for the data/object, record all properties needing a match to track progress
          missingPropertyMatchesForId[sortableValue.value] ??= new Set<string>([ ...Object.keys(filter) ]);
          missingPropertyMatchesForId[sortableValue.value].delete(propertyName);
          if (missingPropertyMatchesForId[sortableValue.value].size === 0) {
            // full filter match, add it to return list
            matchedEvents.set(sortableValue.value, sortableValue.value);
          }
        }
      }
    }
  }

  protected async findExactMatches(
    tenant:string,
    propertyName: string,
    propertyValue: unknown,
    sortProperty: string,
    sortDirection: SortOrder,
    cursor?: string,
  ): Promise<SortableValue[]> {
    const tenantEventLog = await this.db.partition(tenant);
    const cidIndex = await tenantEventLog.partition(INDEX_SUBLEVEL_NAME);

    const prefixParts = [ `__${sortProperty}`, propertyName, this.encodeValue(propertyValue) ];
    const matchPrefix = this.join(...prefixParts, '');

    const iteratorOptions: LevelWrapperIteratorOptions<string> = {};
    if (sortDirection === SortOrder.Ascending) {
      iteratorOptions.gt = cursor ? this.join(...prefixParts, this.encodeValue(cursor)) : matchPrefix;
    } else {
      iteratorOptions.lt = cursor ? this.join(...prefixParts, this.encodeValue(cursor)) : matchPrefix;
      iteratorOptions.reverse = true;
    }

    const matches: SortableValue[] = [];
    for await (const [ key, value ] of cidIndex.iterator(iteratorOptions)) {
      if (!key.startsWith(matchPrefix)) {
        break;
      }
      const sortValue = this.extractSortValueFromKey(key);
      // do not match the exact cursor
      if (cursor && sortValue === this.encodeValue(cursor)) {
        continue;
      }
      matches.push({ value, sortValue });
    }

    if (iteratorOptions.reverse === true) {
      return matches.reverse();
    }
    return matches;
  }

  private async findRangeMatches(
    tenant: string,
    propertyName: string,
    rangeFilter: RangeFilter,
    sortProperty: string,
    sortDirection: SortOrder,
    cursor?: string
  ): Promise<SortableValue[]> {
    const tenantEventLog = await this.db.partition(tenant);
    const cidIndex = await tenantEventLog.partition(INDEX_SUBLEVEL_NAME);
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
    const matches: SortableValue[] = [];
    for await (const [ key, value ] of cidIndex.iterator(iteratorOptions)) {
      // if "greater-than" is specified, skip all keys that contains the exact value given in the "greater-than" condition
      if ('gt' in rangeFilter && this.extractValueFromKey(key) === this.encodeValue(rangeFilter.gt)) {
        continue;
      }

      // immediately stop if we arrive at an index entry for a different property
      if (!key.startsWith(matchPrefix)) {
        break;
      }

      const sortValue = this.extractSortValueFromKey(key);
      // do not match the cursor
      if (cursor && sortValue === this.encodeValue(cursor)) {
        continue;
      }

      matches.push({ sortValue, value });
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

    return matches.sort((a,b) => lexicographicalCompare(a.sortValue, b.sortValue));
  }

  private extractSortValueFromKey(key: string): string {
    const [,,,value] = key.split(IndexLevel.delimiter);
    return value;
  }

  private extractValueFromKey(key: string): string {
    const [,,value] = key.split(IndexLevel.delimiter);
    return value;
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

  protected encodeValue(value: unknown): string {
    switch (typeof value) {
    case 'string':
      // We can't just `JSON.stringify` as that'll affect the sort order of strings.
      // For example, `'\x00'` becomes `'\\u0000'`.
      return `"${value}"`;
    case 'number':
      return MessageIndex.encodeNumberValue(value);
    default:
      return String(value);
    }
  }

  /**
   * Joins the given values using the `\x00` (\u0000) character.
   */
  protected static delimiter = `\x00`;
  protected join(...values: unknown[]): string {
    return values.join(IndexLevel.delimiter);
  }
}

/**
 * A LevelDB implementation for indexing the messages stored in the DWN.
 */
export class MessageIndex extends IndexLevel {

  constructor(config: IndexLevelConfig) {
    const indexConfig: IndexLevelConfig = {
      createLevelDatabase,
      ...config
    };
    super(indexConfig);

  }


  /**
   * Adds indexes for a specific data/object/content.
   * @param dataId ID of the data/object/content being indexed.
   */
  async put(
    tenant: string,
    dataId: string,
    indexes: { [property: string]: unknown },
    options?: IndexLevelOptions
  ): Promise<void> {
    const partition = await executeUnlessAborted(this.db.partition(tenant), options?.signal);
    indexes = flatten(indexes);
    // create sort indexes
    for (const propertyName in indexes) {
      switch (propertyName) {
      case 'messageTimestamp':
      case 'dateCreated':
      case 'datePublished':
      }
    }

    const operations: LevelWrapperBatchOperation<string>[] = [ ];

    // create an index entry for each property in the `indexes`
    for (const propertyName in indexes) {
      const propertyValue = indexes[propertyName];

      // NOTE: appending data ID after (property + value) serves two purposes:
      // 1. creates a unique entry of the property-value pair per data/object
      // 2. when we need to delete all indexes of a given data ID (`delete()`), we can reconstruct the index keys and remove the indexes efficiently
      //
      // example keys (\u0000 is just shown for illustration purpose because it is the delimiter used to join the string segments below):
      // 'interface\u0000"Records"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // 'method\u0000"Write"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // 'schema\u0000"http://ud4kyzon6ugxn64boz7v"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // 'dataCid\u0000"bafkreic3ie3cxsblp46vn3ofumdnwiqqk4d5ah7uqgpcn6xps4skfvagze"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // 'dateCreated\u0000"2023-05-25T18:23:29.425008Z"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      const key = this.join(propertyName, this.encodeValue(propertyValue), dataId);
      operations.push({ type: 'put', key, value: dataId });
    }

    // create a reverse lookup entry for data ID -> its indexes
    // this is for indexes deletion (`delete()`): so that given the data ID, we are able to delete all its indexes
    // we can consider putting this info in a different data partition if this ever becomes more complex/confusing
    operations.push({ type: 'put', key: `__${dataId}__indexes`, value: JSON.stringify(indexes) });

    await partition.batch(operations, options);
  }

  async query(tenant: string, filters: Filter[], options?: IndexLevelOptions): Promise<Array<string>> {
    const matchedIDs: Map<string, string> = new Map();

    for (const filter of filters) {
      await this.executeSingleFilterQuery(tenant, { filter, sort: 'messageTimestamp', sortDirection: SortOrder.Ascending, }, matchedIDs);
    }

    return [...matchedIDs.values()];
  }

  async delete(tenant: string, dataId: string, options?: IndexLevelOptions): Promise<void> {
    const partition = await executeUnlessAborted(this.db.partition(tenant), options?.signal);
    const serializedIndexes = await partition.get(`__${dataId}__indexes`, options);
    if (!serializedIndexes) {
      return;
    }

    const indexes = JSON.parse(serializedIndexes);

    // delete all indexes associated with the data of the given ID
    const ops: LevelWrapperBatchOperation<string>[] = [ ];
    for (const propertyName in indexes) {
      const propertyValue = indexes[propertyName];
      const key = this.join(propertyName, this.encodeValue(propertyValue), dataId);
      ops.push({ type: 'del', key });
    }

    ops.push({ type: 'del', key: `__${dataId}__indexes` });

    await partition.batch(ops, options);
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
}

type IndexLevelConfig = {
  location: string,
  createLevelDatabase?: typeof createLevelDatabase,
};
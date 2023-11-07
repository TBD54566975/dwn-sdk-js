import type { Filter, RangeFilter } from '../types/message-types.js';
import type { LevelWrapperBatchOperation, LevelWrapperIteratorOptions } from './level-wrapper.js';

import { executeUnlessAborted } from '../utils/abort.js';
import { flatten } from '../utils/object.js';
import { createLevelDatabase, LevelWrapper } from './level-wrapper.js';

export interface IndexLevelOptions {
  signal?: AbortSignal;
}

/**
 * A LevelDB implementation for indexing the messages stored in the DWN.
 */
export class IndexLevel {
  config: IndexLevelConfig;

  db: LevelWrapper<string>;

  constructor(config: IndexLevelConfig) {
    this.config = {
      createLevelDatabase,
      ...config
    };

    this.db = new LevelWrapper<string>({ ...this.config, valueEncoding: 'utf8' });
  }

  async open(): Promise<void> {
    return this.db.open();
  }

  async close(): Promise<void> {
    return this.db.close();
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

  /**
   * Executes the given single filter query and appends the results without duplicate into `matchedIDs`.
   */
  private async executeSingleFilterQuery(tenant: string, filter: Filter, matchedIDs: Set<string>, options?: IndexLevelOptions): Promise<void> {
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
            const exactMatchesPromise = this.findExactMatches(tenant, propertyName, propertyValue, options);
            propertyNameToPromises[propertyName].push(exactMatchesPromise);
          }
        } else {
          // `propertyFilter` is a `RangeFilter`
          const rangeMatchesPromise = this.findRangeMatches(tenant, propertyName, propertyFilter, options);
          propertyNameToPromises[propertyName] = [rangeMatchesPromise];
        }
      } else {
        // propertyFilter is an EqualFilter, meaning it is a non-object primitive type
        const exactMatchesPromise = this.findExactMatches(tenant, propertyName, propertyFilter, options);
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
        for (const dataId of await promise) {
          // short circuit: if a data is already included to the final matched ID set (by a different `Filter`),
          // no need to evaluate if the data satisfies this current filter being evaluated
          if (matchedIDs.has(dataId)) {
            continue;
          }

          // if first time seeing a property matching for the data/object, record all properties needing a match to track progress
          missingPropertyMatchesForId[dataId] ??= new Set<string>([ ...Object.keys(filter) ]);

          missingPropertyMatchesForId[dataId].delete(propertyName);
          if (missingPropertyMatchesForId[dataId].size === 0) {
            // full filter match, add it to return list
            matchedIDs.add(dataId);
          }
        }
      }
    }
  }

  async query(tenant: string, filters: Filter[], options?: IndexLevelOptions): Promise<Array<string>> {
    const matchedIDs: Set<string> = new Set();

    for (const filter of filters) {
      await this.executeSingleFilterQuery(tenant, filter, matchedIDs, options);
    }

    return [...matchedIDs];
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

  async clear(): Promise<void> {
    return this.db.clear();
  }

  /**
   * @returns IDs of data that matches the exact property and value.
   */
  private async findExactMatches(tenant: string, propertyName: string, propertyValue: unknown, options?: IndexLevelOptions): Promise<string[]> {
    const partition = await executeUnlessAborted(this.db.partition(tenant), options?.signal);
    const propertyValuePrefix = this.join(propertyName, this.encodeValue(propertyValue), '');

    const iteratorOptions: LevelWrapperIteratorOptions<string> = {
      gt: propertyValuePrefix
    };

    const matches: string[] = [];
    for await (const [ key, dataId ] of partition.iterator(iteratorOptions, options)) {
      if (!key.startsWith(propertyValuePrefix)) {
        break;
      }

      matches.push(dataId);
    }
    return matches;
  }

  /**
   * @returns IDs of data that matches the range filter.
   */
  private async findRangeMatches(tenant: string, propertyName: string, rangeFilter: RangeFilter, options?: IndexLevelOptions): Promise<string[]> {
    const partition = await executeUnlessAborted(this.db.partition(tenant), options?.signal);
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

    const matches: string[] = [];
    for await (const [ key, dataId ] of partition.iterator(iteratorOptions, options)) {
      // if "greater-than" is specified, skip all keys that contains the exact value given in the "greater-than" condition
      if ('gt' in rangeFilter && IndexLevel.extractValueFromKey(key) === this.encodeValue(rangeFilter.gt)) {
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
      for (const dataId of await this.findExactMatches(tenant, propertyName, rangeFilter.lte, options)) {
        matches.push(dataId);
      }
    }

    return matches;
  }

  private encodeValue(value: unknown): string {
    switch (typeof value) {
    case 'string':
      // We can't just `JSON.stringify` as that'll affect the sort order of strings.
      // For example, `'\x00'` becomes `'\\u0000'`.
      return `"${value}"`;
    case 'number':
      return IndexLevel.encodeNumberValue(value);
    default:
      return String(value);
    }
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

  /**
   * Joins the given values using the `\x00` (\u0000) character.
   */
  private static delimiter = `\x00`;
  private join(...values: unknown[]): string {
    return values.join(IndexLevel.delimiter);
  }
}

type IndexLevelConfig = {
  location: string,
  createLevelDatabase?: typeof createLevelDatabase,
};
import type { Filter, RangeFilter } from '../types/message-types.js';
import type { LevelWrapperBatchOperation, LevelWrapperIteratorOptions } from './level-wrapper.js';

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
    dataId: string,
    indexes: { [property: string]: unknown },
    options?: IndexLevelOptions
  ): Promise<void> {

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

    await this.db.batch(operations, options);
  }

  async query(filter: Filter, options?: IndexLevelOptions): Promise<Array<string>> {
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
            const exactMatchesPromise = this.findExactMatches(propertyName, propertyValue, options);
            propertyNameToPromises[propertyName].push(exactMatchesPromise);
          }
        } else {
          // `propertyFilter` is a `RangeFilter`
          const rangeMatchesPromise = this.findRangeMatches(propertyName, propertyFilter, options);
          propertyNameToPromises[propertyName] = [rangeMatchesPromise];
        }
      } else {
        // propertyFilter is an EqualFilter, meaning it is a non-object primitive type
        const exactMatchesPromise = this.findExactMatches(propertyName, propertyFilter, options);
        propertyNameToPromises[propertyName] = [exactMatchesPromise];
      }
    }

    // map of ID of all data/object -> list of missing property matches
    // if count of missing property matches is 0, it means the data/object fully matches the filter
    const missingPropertyMatchesForId: { [dataId: string]: Set<string> } = { };

    // Resolve promises and find the union of results for each individual propertyName DB query
    const matchedIDs: string[] = [ ];
    for (const [propertyName, promises] of Object.entries(propertyNameToPromises)) {
      // acting as an OR match for the property, any of the promises returning a match will be treated as a property match
      for (const promise of promises) {
        for (const dataId of await promise) {
          // if first time seeing a property matching for the data/object, record all properties needing a match to track progress
          missingPropertyMatchesForId[dataId] ??= new Set<string>([ ...Object.keys(filter) ]);

          missingPropertyMatchesForId[dataId].delete(propertyName);
          if (missingPropertyMatchesForId[dataId].size === 0) {
            // full filter match, add it to return list
            matchedIDs.push(dataId);
          }
        }
      }
    }

    return matchedIDs;
  }

  async delete(dataId: string, options?: IndexLevelOptions): Promise<void> {
    const serializedIndexes = await this.db.get(`__${dataId}__indexes`, options);
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

    await this.db.batch(ops, options);
  }

  async clear(): Promise<void> {
    return this.db.clear();
  }

  /**
   * @returns IDs of data that matches the exact property and value.
   */
  private async findExactMatches(propertyName: string, propertyValue: unknown, options?: IndexLevelOptions): Promise<string[]> {
    const propertyValuePrefix = this.join(propertyName, this.encodeValue(propertyValue), '');

    const iteratorOptions: LevelWrapperIteratorOptions<string> = {
      gt: propertyValuePrefix
    };

    const matches: string[] = [];
    for await (const [ key, dataId ] of this.db.iterator(iteratorOptions, options)) {
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
  private async findRangeMatches(propertyName: string, rangeFilter: RangeFilter, options?: IndexLevelOptions): Promise<string[]> {
    const propertyNamePrefix = this.join(propertyName, '');
    const iteratorOptions: LevelWrapperIteratorOptions<string> = {
      gt: propertyNamePrefix
    };

    const filterConditions: Array<(value: string) => boolean> = [];
    for (const comparator in rangeFilter) {
      const comparatorName = comparator as keyof RangeFilter;
      const comparatorValue = rangeFilter[comparatorName];
      if (!comparatorValue) {
        continue;
      }
      const encodedComparatorValue = this.encodeValue(comparatorValue);

      switch (comparatorName) {
      case 'lt':
        filterConditions.push((v) => v < encodedComparatorValue);
        break;
      case 'lte':
        filterConditions.push((v) => v <= encodedComparatorValue);
        break;
      case 'gt':
        filterConditions.push((v) => v > encodedComparatorValue);
        break;
      case 'gte':
        filterConditions.push((v) => v >= encodedComparatorValue);
        break;
      }
    }

    const matches: string[] = [];
    for await (const [ key, dataId ] of this.db.iterator(iteratorOptions, options)) {
      const [, value] = key.split(this.delimiter);
      // immediately stop if we arrive at an index entry for a different property
      if (!key.startsWith(propertyNamePrefix)) {
        break;
      }

      const allPass = filterConditions.every((c) => c(value));
      if (allPass) {
        matches.push(dataId);
      }
    }

    return matches;
  }

  private encodeValue(value: unknown): string {
    if (typeof value === 'string') {
      // We can't just `JSON.stringify` as that'll affect the sort order of strings.
      // For example, `'\x00'` becomes `'\\u0000'`.
      return `"${value}"`;
    }

    return String(value);
  }

  /**
   * Joins the given values using the `\x00` (\u0000) character.
   */
  private delimiter = `\x00`;
  private join(...values: unknown[]): string {
    return values.join(this.delimiter);
  }

  async dump(): Promise<void> {
    console.group('db');
    await this.db['dump']?.();
    console.groupEnd();
  }
}

type IndexLevelConfig = {
  location: string,
  createLevelDatabase?: typeof createLevelDatabase,
};
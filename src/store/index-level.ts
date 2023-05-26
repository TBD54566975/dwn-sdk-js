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
   * @param id ID of the data/object/content being indexed.
   */
  async put(
    id: string,
    indexes: { [property: string]: unknown },
    options?: IndexLevelOptions
  ): Promise<void> {

    indexes = flatten(indexes);

    const operations: LevelWrapperBatchOperation<string>[] = [ ];

    // create an index entry for each property in the `indexes`
    for (const propertyName in indexes) {
      const value = indexes[propertyName];

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
      const key = this.join(propertyName, this.encodeValue(value), id);
      operations.push({ type: 'put', key, value: id });
    }

    // create a reverse lookup entry for data ID -> its indexes
    // this is for indexes deletion (`delete()`): so that given the data ID, we are able to delete all its indexes
    // we can consider putting this info in a different data partition if this ever becomes more complex/confusing
    operations.push({ type: 'put', key: `__${id}__indexes`, value: JSON.stringify(indexes) });

    return this.db.batch(operations, options);
  }

  async query(filter: Filter, options?: IndexLevelOptions): Promise<Array<string>> {
    // Note: We have an array of Promises in order to support OR (anyOf) matches when given a list of accepted values for a property
    const propertyNameToPromises: { [key: string]: Promise<string[]>[] } = {};

    // Do a separate DB query for each property in `filter`
    // We will find the union of these many individual queries later.
    for (const propertyName in filter) {
      const propertyFilter = filter[propertyName];

      if (propertyFilter === null) {
        continue;
      }

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
    // if list of missing property matches is 0, then it data/object is fully matches the filter
    const missingPropertyMatchesForId: { [id: string]: Set<string> } = { };

    // Resolve promises and find the union of results for each individual propertyName DB query
    const matchedIDs: string[] = [ ];
    for (const [propertyName, promises] of Object.entries(propertyNameToPromises)) {
      // acting as an OR match for the property, any of the promises returning a match will be treated as a property match
      for (const promise of promises) {
        for (const id of await promise) {
          // if first time seeing a property matching for the data/object, record all properties needing a match to track progress
          missingPropertyMatchesForId[id] ??= new Set<string>([ ...Object.keys(filter) ]);

          missingPropertyMatchesForId[id].delete(propertyName);
          if (missingPropertyMatchesForId[id].size === 0) {
            // full filter match, add it to return list
            matchedIDs.push(id);
          }
        }
      }
    }

    return matchedIDs;
  }

  async delete(id: string, options?: IndexLevelOptions): Promise<void> {
    const serializedIndexes = await this.db.get(`__${id}__indexes`, options);
    if (!serializedIndexes) {
      return;
    }

    const indexes = JSON.parse(serializedIndexes);

    // delete all indexes associated with the data of the given ID
    const ops: LevelWrapperBatchOperation<string>[] = [ ];
    for (const propertyName in indexes) {
      const value = indexes[propertyName];
      const key = this.join(propertyName, this.encodeValue(value), id);
      ops.push({ type: 'del', key });
    }

    ops.push({ type: 'del', key: `__${id}__indexes` });

    return this.db.batch(ops, options);
  }

  async clear(): Promise<void> {
    return this.db.clear();
  }

  /**
   * @returns IDs that matches the exact property and value.
   */
  private async findExactMatches(propertyName: string, propertyValue: unknown, options?: IndexLevelOptions): Promise<string[]> {
    const propertyValuePrefix = this.join(propertyName, this.encodeValue(propertyValue));

    const iteratorOptions: LevelWrapperIteratorOptions<string> = {
      gt: propertyValuePrefix
    };

    const matches: string[] = [];
    for await (const [ key, id ] of this.db.iterator(iteratorOptions, options)) {
      if (!key.startsWith(propertyValuePrefix)) {
        break;
      }

      matches.push(id);
    }
    return matches;
  }

  /**
   * @returns IDs that matches the range filter.
   */
  private async findRangeMatches(propertyName: string, range: RangeFilter, options?: IndexLevelOptions): Promise<string[]> {
    const iteratorOptions: LevelWrapperIteratorOptions<string> = { };
    for (const comparator in range) {
      iteratorOptions[comparator] = this.join(propertyName, this.encodeValue(range[comparator]));
    }

    // if there is no lower bound specified (`gt` or `gte`), we need to iterate from the upper bound,
    // so that we will iterate over all the matches before hitting mismatches.
    if (iteratorOptions.gt === undefined && iteratorOptions.gte === undefined) {
      iteratorOptions.reverse = true;
    }

    const matches: string[] = [];
    for await (const [ key, id ] of this.db.iterator(iteratorOptions, options)) {
      // immediately stop if we arrive at an index entry for a different property
      if (!key.startsWith(propertyName)) {
        break;
      }

      matches.push(id);
    }

    if ('lte' in range) {
      // When `lte` is used, we must also query the exact match explicitly because the exact match will not be included in the iterator above.
      // This is due to the extra data (CID) appended to the (property + value) key prefix, e.g.
      // key = 'dateCreated\u0000"2023-05-25T11:22:33.000000Z"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // the value would be considered greater than { lte: `dateCreated\u0000"2023-05-25T11:22:33.000000Z"` } in the iterator options,
      // thus would not included in such iterator even though we'd like it to be.
      for (const id of await this.findExactMatches(propertyName, range.lte, options)) {
        matches.push(id);
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
  private join(...values: unknown[]): string {
    return values.join(`\x00`);
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
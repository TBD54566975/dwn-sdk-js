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

    const ops: LevelWrapperBatchOperation<string>[] = [ ];
    const propertyValuePairs: string[] = [ ];

    // create an index entry for each property in the `indexes`
    for (const property in indexes) {
      const value = indexes[property];

      // example keys (\u0000 is just shown for illustration purpose because it is the delimiter used to join the string segments below):
      // 'interface\u0000"Records"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // 'method\u0000"Write"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // 'schema\u0000"http://ud4kyzon6ugxn64boz7v"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // 'dataCid\u0000"bafkreic3ie3cxsblp46vn3ofumdnwiqqk4d5ah7uqgpcn6xps4skfvagze"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // 'dateCreated\u0000"2023-05-25T18:23:29.425008Z"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      const propertyValuePair = this.join(property, this.encodeValue(value));

      // NOTE: appending data ID serves two purposes:
      // 1. creates a unique entry of the property-value pair per data/object
      // 2. when we need to delete all indexes of a given data ID (`delete()`), we can reconstruct the index keys and remove the indexes efficiently
      const key = this.join(propertyValuePair, id);
      ops.push({ type: 'put', key, value: id });
      propertyValuePairs.push(propertyValuePair);
    }

    // create a reverse lookup entry for data ID -> all its indexes
    // this is for indexes deletion (`delete`): so that given the data ID, we are able to delete all its indexes
    ops.push({ type: 'put', key: `__${id}__prefixes`, value: JSON.stringify(propertyValuePairs) });

    return this.db.batch(ops, options);
  }

  async query(filter: Filter, options?: IndexLevelOptions): Promise<Array<string>> {
    // Note: We need to have an array of Promise<Matches> in order to support OR (anyOf) matches when given an array of accepted values for a property
    const propertyNameToPromises: { [key: string]: Promise<Matches>[] } = {};

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
    for await (const [propertyName, promises] of Object.entries(propertyNameToPromises)) {
      for (const promise of promises) {
        for (const [ _, id ] of await promise) {
          // if first time seeing a property match for object, add all the properties in the filter to missingPropertyMatchesForId to track
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
    const prefixes = await this.db.get(`__${id}__prefixes`, options);
    if (!prefixes) {
      return;
    }

    const ops: LevelWrapperBatchOperation<string>[] = [ ];
    for (const prefix of JSON.parse(prefixes)) {
      ops.push({ type: 'del', key: this.join(prefix, id) });
    }
    ops.push({ type: 'del', key: `__${id}__prefixes` });

    return this.db.batch(ops, options);
  }

  async clear(): Promise<void> {
    return this.db.clear();
  }

  private async findExactMatches(propertyName: string, propertyValue: unknown, options?: IndexLevelOptions): Promise<Matches> {
    const propertyValuePrefix = this.join(propertyName, this.encodeValue(propertyValue));

    const iteratorOptions: LevelWrapperIteratorOptions<string> = {
      gt: propertyValuePrefix
    };

    const matches = new Map<string, string>;
    for await (const [ key, value ] of this.db.iterator(iteratorOptions, options)) {
      if (!key.startsWith(propertyValuePrefix)) {
        break;
      }

      matches.set(key, value);
    }
    return matches;
  }

  private async findRangeMatches(propertyName: string, range: RangeFilter, options?: IndexLevelOptions): Promise<Matches> {
    const iteratorOptions: LevelWrapperIteratorOptions<string> = { };
    for (const comparator in range) {
      iteratorOptions[comparator] = this.join(propertyName, this.encodeValue(range[comparator]));
    }

    // if there is no lower bound specified (`gt` or `gte`), we need to iterate from the upper bound,
    // so that we will iterate over all the matches before hitting mismatches.
    if (iteratorOptions.gt === undefined && iteratorOptions.gte === undefined) {
      iteratorOptions.reverse = true;
    }

    const matches = new Map<string, string>;
    for await (const [ key, value ] of this.db.iterator(iteratorOptions, options)) {
      // immediately stop if we arrive at an index entry for a different property
      if (!key.startsWith(propertyName)) {
        break;
      }

      matches.set(key, value);
    }

    if ('lte' in range) {
      // When `lte` is used, we must also query the exact match explicitly because the exact match will not be included in the iterator above.
      // This is due to the extra data (CID) appended to the (property + value) key prefix, e.g.
      // key = 'dateCreated\u0000"2023-05-25T11:22:33.000000Z"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // the value would be considered greater than { lte: `dateCreated\u0000"2023-05-25T11:22:33.000000Z"` } in the iterator options,
      // thus would not included in such iterator even though we'd like it to be.
      for (const [ key, value ] of await this.findExactMatches(propertyName, range.lte, options)) {
        matches.set(key, value);
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

type Matches = Map<string, string>;
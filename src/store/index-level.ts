import type { Filter, OneOfFilter, RangeFilter } from '../types/message-types.js';
import type { LevelWrapperBatchOperation, LevelWrapperIteratorOptions, } from './level-wrapper.js';

import { SortDirection } from '../types/message-types.js';
import { createLevelDatabase, LevelWrapper } from './level-wrapper.js';
import { flatten, isEmptyObject, removeUndefinedProperties } from '../utils/object.js';

type Indexes = { [key: string]: unknown };

type IndexLevelConfig = {
  location?: string,
  createLevelDatabase?: typeof createLevelDatabase
};

export type QueryOptions = {
  sortProperty: string;
  sortDirection?: SortDirection;
  limit?: number;
  cursor?: string;
};

const INDEX_SUBLEVEL_NAME = 'index';

export interface IndexLevelOptions {
  signal?: AbortSignal;
}

/**
 * A LevelDB implementation for indexing the messages and events stored in the DWN.
 */
export class IndexLevel<T> {
  db: LevelWrapper<string>;
  config: IndexLevelConfig;

  constructor(config: IndexLevelConfig) {
    this.config = {
      createLevelDatabase,
      ...config,
    };

    this.db = new LevelWrapper<string>({
      location            : this.config.location!,
      createLevelDatabase : this.config.createLevelDatabase,
      keyEncoding         : 'utf8'
    });
  }

  async open(): Promise<void> {
    await this.db.open();
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  /**
 * deletes everything in the underlying index db.
 */
  async clear(): Promise<void> {
    await this.db.clear();
  }

  /**
   * Put an item into the index using information that will allow it to be queried for.
   *
   * @param tenant
   * @param itemId a unique ID that represents the item being indexed, this is also used as the cursor value in a query.
   * @param value the value representing the data being indexed.
   * @param indexes - (key-value pairs) to be included as part of indexing this item. Must include at least one indexing property.
   * @param sortIndexes - (key-value pairs) to be used for sorting the index. Must include at least one sorting property.
   * @param options IndexLevelOptions that include an AbortSignal.
   */
  async put(
    tenant: string,
    itemId: string,
    value: T,
    indexes: Indexes,
    sortIndexes: Indexes,
    options?: IndexLevelOptions
  ): Promise<void> {
    // ensure sorted indexes are flat and exist
    sortIndexes = flatten(sortIndexes);
    removeUndefinedProperties(sortIndexes);

    if (isEmptyObject(sortIndexes)) {
      throw new Error('must include at least one sorted index');
    }

    // ensure indexable properties exist
    indexes = flatten(indexes);
    removeUndefinedProperties(indexes);

    if (isEmptyObject(indexes)) {
      throw new Error('must include at least one indexable property');
    }

    const tenantPartition = await this.db.partition(tenant);

    const indexOps: LevelWrapperBatchOperation<string>[] = [];
    // store the value and indexes for each of the sorted properties
    for (const sortProperty in sortIndexes) {
      const sortValue = sortIndexes[sortProperty];
      // each sortProperty is treated as it's own partition.
      // This allows the LevelDB system to calculate a gt minKey and lt maxKey for each of the sort properties
      // which facilitates iterating in reverse for descending order queries without iterating through different sort properties.
      // the key is simply the sortValue followed by the itemId as a tie-breaker.
      // ex: '"2023-05-25T18:23:29.425008Z"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      const key = IndexLevel.keySegmentJoin(this.encodeValue(sortValue), itemId);

      // we write the values into a sublevel-partition of tenantPartition.
      // we wrap it in __${sortProperty}__sort so that it does not clash with other sublevels ie "index"
      indexOps.push(tenantPartition.partitionOperation(`__${sortProperty}__sort`, {
        key,
        type  : 'put',
        value : JSON.stringify({ indexes, value })
      }));
    }

    // create a reverse index for the sortedIndex values. This is used during deletion and cursor starting point lookup.
    indexOps.push(tenantPartition.partitionOperation(INDEX_SUBLEVEL_NAME,
      { type: 'put', key: itemId, value: JSON.stringify(sortIndexes) }
    ));

    await tenantPartition.batch(indexOps, options);
  }

  /**
   *  Deletes all of the index data associated with the item.
   */
  async delete(tenant: string, itemId: string, options?: IndexLevelOptions): Promise<void> {
    const tenantPartition = await this.db.partition(tenant);
    const indexOps: LevelWrapperBatchOperation<string>[] = [];

    const sortIndexes = await this.getSortIndexes(tenant, itemId);
    if (sortIndexes === undefined) {
      // invalid itemId
      return;
    }

    // delete the reverse lookup
    indexOps.push(tenantPartition.partitionOperation(INDEX_SUBLEVEL_NAME,
      { type: 'del', key: itemId }
    ));

    // delete the keys for each sortIndex
    for (const sortProperty in sortIndexes) {
      const sortValue = sortIndexes[sortProperty];
      indexOps.push(tenantPartition.partitionOperation(`__${sortProperty}__sort`, {
        type : 'del',
        key  : IndexLevel.keySegmentJoin(this.encodeValue(sortValue), itemId),
      }));
    }

    await tenantPartition.batch(indexOps, options);
  }

  /**
   * Queries the index for items that match the filters. If no filters are provided, all records are returned.
   *
   * @param tenant
   * @param filters Array of filters that are treated as an OR query.
   * @param queryOptions query options for sort and pagination, requires at least `sortProperty`. The default sort direction is ascending.
   * @param options IndexLevelOptions that include an AbortSignal.
   */
  async query(tenant:string, filters: Filter[], queryOptions: QueryOptions, options?: IndexLevelOptions): Promise<T[]> {
    const { sortProperty, limit, sortDirection = SortDirection.Ascending, cursor } = queryOptions;

    // if there is a cursor we fetch the starting key given the sort property, otherwise we start from the beginning of the index.
    const startKey = cursor ? await this.getStartingKeyForCursor(tenant, cursor, sortProperty) : '';
    if (startKey === undefined) {
      // getStartingKeyForCursor returns undefined if an invalid cursor is provided, we return an empty result set.
      return [];
    }

    const iteratorOptions: LevelWrapperIteratorOptions<string> = {
      gt: startKey
    };

    // if we are sorting in descending order we can iterate in reverse.
    if (sortDirection === SortDirection.Descending) {
      iteratorOptions.reverse = true;
      if (cursor !== undefined) {
        // if a cursor is provided and we are sorting in descending order, the startKey should be the upper bound.
        iteratorOptions.lt = startKey;
        delete iteratorOptions.gt;
      }
    }

    const matches: Array<T> = [];

    const tenantPartition = await this.db.partition(tenant);
    const sortPartition = await tenantPartition.partition(`__${sortProperty}__sort`);
    for await (const [ _, val ] of sortPartition.iterator(iteratorOptions, options)) {
      if (limit !== undefined && matches.length === limit) {
        return matches;
      }

      const { value, indexes } = JSON.parse(val);
      // if there aren't any filters present, we return any sorted item.
      if (filters.length === 0) {
        matches.push(value);
        continue; //next match
      }

      for (const filter of filters) {
        // if any of the filters match the indexed values, it is a match and move on to the next.
        if (this.matchFilter(indexes, filter)) {
          matches.push(value);
          break; // next match
        }
      }
    }

    return matches;
  }

  /**
   * Gets the sort indexes given an itemId. This is a reverse lookup to construct starting keys, as well as deleting indexed items.
   */
  private async getSortIndexes(tenant: string, itemId: string): Promise<Indexes|undefined> {
    const tenantPartition = await this.db.partition(tenant);
    const indexPartition = await tenantPartition.partition(INDEX_SUBLEVEL_NAME);
    const serializedIndexes = await indexPartition.get(itemId);
    if (serializedIndexes === undefined) {
      // invalid itemId
      return;
    }

    return JSON.parse(serializedIndexes) as Indexes;
  }

  /**
   * Gets the sort property starting point for a LevelDB query given an itemId as a cursor.
   * Used as (gt) for ascending queries, or (lt) for descending queries.
   */
  private async getStartingKeyForCursor(tenant: string, itemId: string, sortProperty: string): Promise<string|undefined> {
    const sortIndexes = await this.getSortIndexes(tenant, itemId);
    if (sortIndexes === undefined) {
      // invalid itemId
      return;
    }

    const sortValue = sortIndexes[sortProperty];
    if (sortValue === undefined) {
      // invalid sort property
      return undefined;
    }
    return IndexLevel.keySegmentJoin(this.encodeValue(sortValue), itemId);
  }

  /**
   * Evaluates a OneOfFilter given an indexedValue extracted from the index.
   *
   * @param filter An array of EqualityFilters. Treated as an OR.
   * @param indexedValue the indexed value being compared.
   * @returns true if any of the given filters match the indexedValue
   */
  private matchOneOf(filter: OneOfFilter, indexedValue: unknown): boolean {
    for (const orFilterValue of new Set(filter)) {
      if (this.encodeValue(indexedValue) === this.encodeValue(orFilterValue)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Evaluates if the given indexedValue is within the range given by the RangeFilter.
   *
   * @param rangeFilter
   * @param indexedValue
   * @returns true if all of the range filter conditions are met.
   */
  private matchRange(rangeFilter: RangeFilter, indexedValue: unknown): boolean {
    const filterConditions: Array<(value: string) => boolean> = [];
    for (const filterComparator in rangeFilter) {
      const comparatorName = filterComparator as keyof RangeFilter;
      const filterComparatorValue = rangeFilter[comparatorName];
      const encodedFilterValue = this.encodeValue(filterComparatorValue);
      switch (comparatorName) {
      case 'lt':
        filterConditions.push((v) => v < encodedFilterValue);
        break;
      case 'lte':
        filterConditions.push((v) => v <= encodedFilterValue);
        break;
      case 'gt':
        filterConditions.push((v) => v > encodedFilterValue);
        break;
      case 'gte':
        filterConditions.push((v) => v >= encodedFilterValue);
        break;
      }
    }
    return filterConditions.every((c) => c(this.encodeValue(indexedValue)));
  }

  /**
   * Evaluates the given filter against the indexed values retrieved from the DB.
   *
   * @param indexedValues the indexed values for an item retrieved from teh database.
   * @param filter
   * @returns true if all of the filter properties match.
   */
  private matchFilter(indexedValues: Indexes, filter: Filter): boolean {
    // set of unique query properties.
    // if count of missing property matches is 0, it means the data/object fully matches the filter
    const missingPropertyMatchesForId: Set<string> = new Set([ ...Object.keys(filter) ]);

    for (const filterName in filter) {
      const filterValue = filter[filterName];
      const indexedValue = indexedValues[filterName];
      if (indexedValue === undefined) {
        return false;
      }

      if (typeof filterValue === 'object') {
        if (Array.isArray(filterValue)) {
          // `propertyFilter` is a OneOfFilter
          // if OneOfFilter, the cursor properties are a map of each individual EqualFilter and the associated cursor string
          // Support OR matches by querying for each values separately,
          if (this.matchOneOf(filterValue, indexedValue)) {
            missingPropertyMatchesForId.delete(filterName);
            if (missingPropertyMatchesForId.size === 0) {
              return true;
            }
          }
        } else {
          // `propertyFilter` is a `RangeFilter`
          // if RangeFilter use the string curser associated with the `propertyName`
          if (this.matchRange(filterValue, indexedValue)) {
            missingPropertyMatchesForId.delete(filterName);
            if (missingPropertyMatchesForId.size === 0) {
              return true;
            }
          }
        }
      } else {
        // propertyFilter is an EqualFilter, meaning it is a non-object primitive type
        // if EqualFilter use the string cursor associated with the `propertyName`
        if (this.encodeValue(indexedValue) === this.encodeValue(filterValue)) {
          missingPropertyMatchesForId.delete(filterName);
          if (missingPropertyMatchesForId.size === 0) {
            return true;
          }
        }
      }
    }
    return missingPropertyMatchesForId.size === 0;
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
   * Joins the given values using the `\x00` (\u0000) character.
   */
  private static delimiter = `\x00`;
  private static keySegmentJoin(...values: unknown[]): string {
    return values.join(IndexLevel.delimiter);
  }
}
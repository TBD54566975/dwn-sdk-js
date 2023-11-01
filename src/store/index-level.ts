import type { LevelWrapper } from './level-wrapper.js';
import type { Filter, OneOfFilter, RangeFilter } from '../types/message-types.js';
import type { LevelWrapperBatchOperation, LevelWrapperIteratorOptions } from './level-wrapper.js';

import { SortDirection } from '../types/message-types.js';
import { flatten, removeUndefinedProperties } from '../utils/object.js';

type Index = { [key:string]: unknown };

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
  constructor(private db: LevelWrapper<string>) {}

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
    indexes: Index,
    sortIndexes: Index,
    options?: IndexLevelOptions
  ): Promise<void> {
    // ensure sorted indexes are flat and exist
    sortIndexes = flatten(sortIndexes);
    removeUndefinedProperties(sortIndexes);

    if (!sortIndexes || Object.keys(sortIndexes).length === 0) {
      throw new Error('must include at least one sorted index');
    }

    // ensure indexable properties exist
    indexes = flatten(indexes);
    removeUndefinedProperties(indexes);

    if (!indexes || Object.keys(indexes).length === 0) {
      throw new Error('must include at least one indexable property');
    }
    const indexOps: LevelWrapperBatchOperation<string>[] = [];

    const tenantPartition = await this.db.partition(tenant);
    const indexPartition = await tenantPartition.partition(INDEX_SUBLEVEL_NAME);

    // store the value and indexes for each of the sortedIndex
    for (const sortProperty in sortIndexes) {
      const sortValue = sortIndexes[sortProperty];
      const key = IndexLevel.keySegmentJoin(this.encodeValue(sortValue), itemId);
      indexOps.push(indexPartition.sublevelBatchOperation(sortProperty, {
        key,
        type  : 'put',
        value : JSON.stringify({ indexes, value })
      }));
    }
    indexOps.push({ type: 'put', key: `__${itemId}__indexes`, value: JSON.stringify(sortIndexes) });
    await indexPartition.batch(indexOps, options);
  }


  async delete(tenant: string, itemId: string, options?: IndexLevelOptions): Promise<void> {
    const tenantPartition = await this.db.partition(tenant);
    const indexPartition = await tenantPartition.partition(INDEX_SUBLEVEL_NAME);

    const indexOps: LevelWrapperBatchOperation<string>[] = [];
    const indexKey = `__${itemId}__indexes`;
    const serializedIndexes = await indexPartition.get(indexKey);
    if (serializedIndexes === undefined) {
      return;
    }

    const sortIndexes = JSON.parse(serializedIndexes);
    for (const sortProperty in sortIndexes) {
      const sortValue = sortIndexes[sortProperty];
      indexOps.push(indexPartition.sublevelBatchOperation(sortProperty, {
        type : 'del',
        key  : IndexLevel.keySegmentJoin(this.encodeValue(sortValue), itemId),
      }));
    }
    // delete the reverse lookup
    indexOps.push({ type: 'del', key: indexKey });

    await indexPartition.batch(indexOps, options);
  }

  async query(tenant:string, filters: Filter[], queryOptions: QueryOptions, options?: IndexLevelOptions): Promise<T[]> {
    const { sortProperty, limit = 0, sortDirection = SortDirection.Ascending, cursor } = queryOptions;
    const tenantPartition = await this.db.partition(tenant);
    const indexPartition = await tenantPartition.partition(INDEX_SUBLEVEL_NAME);
    const sortPartition = await indexPartition.partition(sortProperty);

    const startKey = cursor ? await this.getSortValueIndex(indexPartition, cursor, sortProperty) : '';
    if (startKey === undefined) {
      // this signifies an invalid cursor, we return an empty result set.
      return [];
    }

    const iteratorOptions: LevelWrapperIteratorOptions<string> = {
      gt: startKey
    };

    if (sortDirection !== SortDirection.Ascending) {
      iteratorOptions.reverse = true;
      if (cursor !== undefined) {
        iteratorOptions.lt = startKey;
        delete iteratorOptions.gt;
      }
    }

    const matches: Array<T> = [];
    for await (const [ _, val ] of sortPartition.iterator(iteratorOptions, options)) {
      if (matches.length > 0 && matches.length === limit) {
        return matches;
      }

      const { value, indexes } = JSON.parse(val);
      for (const filter of filters) {
        if (this.matchQuery(indexes, filter)) {
          matches.push(value);
          break; // next match
        }
      }
    }

    return matches;
  }

  async getSortValueIndex(indexLevel: LevelWrapper<string>, cursor: string, sortProperty: string): Promise<string|undefined> {
    const serializedIndexes = await indexLevel.get(`__${cursor}__indexes`);
    if (serializedIndexes === undefined) {
      return undefined;
    }
    const sortIndexes = JSON.parse(serializedIndexes) as Index;
    const sortValue = sortIndexes[sortProperty];
    // invalid sort property
    if (sortValue === undefined) {
      return undefined;
    }
    return IndexLevel.keySegmentJoin(this.encodeValue(sortValue), cursor);
  }

  matchOneOf(filter: OneOfFilter, itemValue: unknown): boolean {
    for (const orFilterValue of new Set(filter)) {
      if (this.encodeValue(itemValue) === this.encodeValue(orFilterValue)) {
        return true;
      }
    }
    return false;
  }

  matchRange(rangeFilter: RangeFilter, itemValue: unknown): boolean {
    const filterConditions: Array<(value: string) => boolean> = [];
    for (const filterComparator in rangeFilter) {
      const comparatorName = filterComparator as keyof RangeFilter;
      const filterComparatorValue = rangeFilter[comparatorName];
      if (!filterComparatorValue) {
        continue;
      }
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
    return filterConditions.every((c) => c(this.encodeValue(itemValue)));
  }

  matchQuery(values: { [key:string]:unknown }, filter: Filter): boolean {
    // set of unique query properties.
    // if count of missing property matches is 0, it means the data/object fully matches the filter
    const missingPropertyMatchesForId: Set<string> = new Set([ ...Object.keys(filter) ]);

    for (const filterName in filter) {
      const filterValue = filter[filterName];
      const itemValue = values[filterName];
      if (itemValue === undefined) {
        return false;
      }

      if (typeof filterValue === 'object') {
        if (Array.isArray(filterValue)) {
          // `propertyFilter` is a OneOfFilter
          // if OneOfFilter, the cursor properties are a map of each individual EqualFilter and the associated cursor string
          // Support OR matches by querying for each values separately,
          if (this.matchOneOf(filterValue, itemValue)) {
            missingPropertyMatchesForId.delete(filterName);
            if (missingPropertyMatchesForId.size === 0) {
              return true;
            }
          }
        } else {
          // `propertyFilter` is a `RangeFilter`
          // if RangeFilter use the string curser associated with the `propertyName`
          if (this.matchRange(filterValue, itemValue)) {
            missingPropertyMatchesForId.delete(filterName);
            if (missingPropertyMatchesForId.size === 0) {
              return true;
            }
          }
        }
      } else {
        // propertyFilter is an EqualFilter, meaning it is a non-object primitive type
        // if EqualFilter use the string cursor associated with the `propertyName`
        if (this.encodeValue(itemValue) === this.encodeValue(filterValue)) {
          missingPropertyMatchesForId.delete(filterName);
          if (missingPropertyMatchesForId.size === 0) {
            return true;
          }
        }
      }
    }
    return missingPropertyMatchesForId.size === 0;
  }

  private constructIndexKeys(itemId: string, sortIndexes: { [key:string]:unknown }): Array<string> {
    const keys:Array<string> = [];
    for (const sortProperty in sortIndexes) {
      const sortValue = sortIndexes[sortProperty];
      keys.push(IndexLevel.keySegmentJoin(sortProperty, this.encodeValue(sortValue), itemId));
    }
    return keys;
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
   * Joins the given values using the `\x00` (\u0000) character.
   */
  private static delimiter = `\x00`;
  private static keySegmentJoin(...values: unknown[]): string {
    return values.join(IndexLevel.delimiter);
  }
}
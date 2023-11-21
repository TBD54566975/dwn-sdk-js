import type { EqualFilter, Filter, FilterIndex, QueryOptions, RangeFilter } from '../types/query-types.js';
import type { LevelWrapperBatchOperation, LevelWrapperIteratorOptions, } from './level-wrapper.js';

import { lexicographicalCompare } from '../utils/string.js';
import { SortDirection } from '../types/query-types.js';
import { createLevelDatabase, LevelWrapper } from './level-wrapper.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { FilterSelector, FilterUtility } from '../utils/filter.js';
import { isEmptyObject, removeEmptyStrings } from '../utils/object.js';

type IndexLevelConfig = {
  location?: string,
  createLevelDatabase?: typeof createLevelDatabase
};

type Indexes = { [key: string]: FilterIndex };
type IndexedItem = { itemId: string, indexes: Indexes };

const INDEX_SUBLEVEL_NAME = 'index';

export interface IndexLevelOptions {
  signal?: AbortSignal;
}

/**
 * A LevelDB implementation for indexing the messages and events stored in the DWN.
 */
export class IndexLevel {
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
   * @param indexes - (key-value pairs) to be included as part of indexing this item. Must include at least one indexing property.
   * @param options IndexLevelOptions that include an AbortSignal.
   */
  async put(
    tenant: string,
    itemId: string,
    indexes: Indexes,
    options?: IndexLevelOptions
  ): Promise<void> {

    // ensure we have something valid to index, remove any empty strings from index properties
    removeEmptyStrings(indexes);
    if (isEmptyObject(indexes)) {
      throw new DwnError(DwnErrorCode.IndexMissingIndexableProperty, 'Index must include at least one valid indexable property');
    }

    const tenantPartition = await this.db.partition(tenant);
    const indexOps: LevelWrapperBatchOperation<string>[] = [];

    // create an index entry for each property
    // these indexes are all sortable lexicographically.
    for (const sortProperty in indexes) {
      const sortValue = indexes[sortProperty];
      // the key is sortValue followed by the itemId as a tie-breaker.
      // for example if the property is messageTimestamp the key would look like:
      //  '"2023-05-25T18:23:29.425008Z"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      //
      const key = IndexLevel.keySegmentJoin(FilterUtility.encodeValue(sortValue), itemId);
      const item: IndexedItem = { itemId, indexes };

      // we write the values into a sublevel-partition of tenantPartition.
      // putting each property within a sublevel allows the levelDB system to calculate a gt minKey and lt maxKey for each of the properties
      // this prevents them from clashing, especially when iterating in reverse without iterating through other properties.
      //
      // we wrap it in __${sortProperty}__ so that it does not clash with other sublevels that are created aside from properties.
      indexOps.push(tenantPartition.partitionOperation(`__${sortProperty}__`, {
        key,
        type  : 'put',
        value : JSON.stringify(item)
      }));
    }

    // create a reverse lookup for the sortedIndex values. This is used during deletion and cursor starting point lookup.
    indexOps.push(tenantPartition.partitionOperation(INDEX_SUBLEVEL_NAME,
      { type: 'put', key: itemId, value: JSON.stringify(indexes) }
    ));

    await tenantPartition.batch(indexOps, options);
  }

  /**
   *  Deletes all of the index data associated with the item.
   */
  async delete(tenant: string, itemId: string, options?: IndexLevelOptions): Promise<void> {
    const tenantPartition = await this.db.partition(tenant);
    const indexOps: LevelWrapperBatchOperation<string>[] = [];

    const sortIndexes = await this.getIndexes(tenant, itemId);
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
      indexOps.push(tenantPartition.partitionOperation(`__${sortProperty}__`, {
        type : 'del',
        key  : IndexLevel.keySegmentJoin(FilterUtility.encodeValue(sortValue), itemId),
      }));
    }

    await tenantPartition.batch(indexOps, options);
  }

  /**
  * Queries the index for items that match the filters. If no filters are provided, all items are returned.
  *
  * @param tenant
  * @param filters Array of filters that are treated as an OR query.
  * @param queryOptions query options for sort and pagination, requires at least `sortProperty`. The default sort direction is ascending.
  * @param options IndexLevelOptions that include an AbortSignal.
  * @returns {string[]} an array of itemIds that match the given filters.
  */
  async query(tenant: string, filters: Filter[], queryOptions: QueryOptions, options?: IndexLevelOptions): Promise<string[]> {
    // returns an array of which search filters we need to perform a full search on.
    // if there are no search filters returned, we do a full scan on the sorted index.
    const searchFilters = FilterSelector.select(filters, queryOptions);
    if (searchFilters.length === 0) {
      return this.sortedIndexQuery(tenant, filters, queryOptions, options);
    }

    return this.filteredIndexQuery(tenant, filters, searchFilters, queryOptions, options);
  }

  /**
   * Queries the sort property index for items that match the filters. If no filters are provided, all items are returned.
   * This query is a linear iterator over the sorted index, checking each item for a match.
   * If a cursor is provided it starts the iteration at the cursor point.
   */
  async sortedIndexQuery(tenant: string, filters: Filter[], queryOptions: QueryOptions, options?: IndexLevelOptions): Promise<string[]> {
    const { limit, cursor , sortProperty } = queryOptions;
    const matches: string[] = [];

    // if there is a cursor we fetch the starting key given the sort property, otherwise we start from the beginning of the index.
    const startKey = cursor ? await this.getStartingKeyForCursor(tenant, cursor, sortProperty, filters) : '';
    if (startKey === undefined) {
      // getStartingKeyForCursor returns undefined if an invalid cursor is provided, we return an empty result set.
      return [];
    }

    for await ( const item of this.sortedIndexIterator(tenant, startKey, queryOptions, options)) {
      if (limit !== undefined && matches.length === limit) {
        return matches;
      }
      const { itemId, indexes } = item;
      if (FilterUtility.matchItemIndexes(indexes, filters)) {
        matches.push(itemId);
      }
    }
    return matches;
  }

  /**
   * Creates an AsyncGenerator that returns each sorted index item given a specific sortProperty.
   * If a cursor is passed, the starting value (gt or lt) is derived from that.
   */
  private async * sortedIndexIterator(
    tenant: string, startKey:string, queryOptions: QueryOptions, options?: IndexLevelOptions
  ): AsyncGenerator<IndexedItem> {
    const { sortProperty, sortDirection = SortDirection.Ascending, cursor } = queryOptions;

    const iteratorOptions: LevelWrapperIteratorOptions<string> = {
      gt: startKey
    };

    // if we are sorting in descending order we can iterate in reverse.
    if (sortDirection === SortDirection.Descending) {
      iteratorOptions.reverse = true;

      // if a cursor is provided and we are sorting in descending order, the startKey should be the upper bound.
      if (cursor !== undefined) {
        iteratorOptions.lt = startKey;
        delete iteratorOptions.gt;
      }
    }

    const tenantPartition = await this.db.partition(tenant);
    const sortPartition = await tenantPartition.partition(`__${sortProperty}__`);
    for await (const [ _, val ] of sortPartition.iterator(iteratorOptions, options)) {
      const { indexes, itemId } = JSON.parse(val);
      yield { indexes, itemId };
    }
  }

  /**
   * Gets the starting point for a LevelDB query given an itemId as a cursor and the indexed property.
   * Used as (gt) for ascending queries, or (lt) for descending queries.
   */
  private async getStartingKeyForCursor(tenant: string, itemId: string, property: string, filters: Filter[]): Promise<string|undefined> {
    const sortIndexes = await this.getIndexes(tenant, itemId);
    if (sortIndexes === undefined) {
      // invalid itemId
      return;
    }

    const sortValue = sortIndexes[property];
    if (sortValue === undefined) {
      // invalid sort property
      return;
    }

    // cursor indexes must match the provided filters in order to be valid.
    // ie: if someone passes a valid messageCid for a cursor that's not part of the filter.
    if (FilterUtility.matchItemIndexes(sortIndexes, filters)) {
      return IndexLevel.keySegmentJoin(FilterUtility.encodeValue(sortValue), itemId);
    }
  }

  /**
   * Queries the provided searchFilters asynchronously, returning results that match the matchFilters.
   *
   * @param matchFilters the filters passed to the parent query.
   * @param searchFilters the modified filters used for the LevelDB query to search for a subset of items to match against.
   */
  async filteredIndexQuery(
    tenant: string,
    matchFilters: Filter[],
    searchFilters:Filter[],
    queryOptions: QueryOptions,
    options?: IndexLevelOptions
  ): Promise<string[]> {
    const { sortProperty, sortDirection = SortDirection.Ascending, cursor, limit } = queryOptions;

    // we create a matches map so that we can short-circuit matched items within the async single query below.
    const matches:Map<string, IndexedItem> = new Map();

    try {
      await Promise.all(searchFilters.map(filter => {
        return this.executeSingleFilterQuery(tenant, filter, matchFilters, sortProperty, matches, options );
      }));
    } catch (error) {
      if ((error as DwnError).code === DwnErrorCode.IndexInvalidSortProperty) {
        // return empty results if the sort property is invalid.
        return [];
      }
    }

    const sortedValues = [...matches.values()].sort((a,b) => this.sortItems(a,b, sortProperty, sortDirection));

    // we find the cursor point and only return the result starting there + the limit.
    // if there is no cursor index, we just start in the beginning.
    const cursorIndex = cursor ? sortedValues.findIndex(match => match.itemId === cursor) : -1;
    if (cursor !== undefined && cursorIndex === -1) {
      // if a cursor is provided but we cannot find it, we return an empty result set
      return [];
    }

    const start = cursorIndex > -1 ? cursorIndex + 1 : 0;
    const end = limit !== undefined ? start + limit : undefined;

    return sortedValues.slice(start, end).map(match => match.itemId);
  }

  /**
   * Execute a filtered query against a single filter and return all results.
   */
  private async executeSingleFilterQuery(
    tenant: string,
    searchFilter: Filter,
    matchFilters: Filter[],
    sortProperty: string,
    matches: Map<string, IndexedItem>,
    levelOptions?: IndexLevelOptions
  ): Promise<void> {
    // Note: We have an array of Promises in order to support OR (anyOf) matches when given a list of accepted values for a property
    const filterPromises: Promise<IndexedItem[]>[] = [];

    for (const propertyName in searchFilter) {
      const propertyFilter = searchFilter[propertyName];
      // We will find the union of these many individual queries later.
      if (FilterUtility.isEqualFilter(propertyFilter)) {
        // propertyFilter is an EqualFilter, meaning it is a non-object primitive type
        const exactMatchesPromise = this.filterExactMatches(tenant, propertyName, propertyFilter, levelOptions);
        filterPromises.push(exactMatchesPromise);
      } else if (FilterUtility.isOneOfFilter(propertyFilter)) {
        // `propertyFilter` is a OneOfFilter
        // Support OR matches by querying for each values separately,
        // then adding them to the promises associated with `propertyName`
        for (const propertyValue of new Set(propertyFilter)) {
          const exactMatchesPromise = this.filterExactMatches(tenant, propertyName, propertyValue, levelOptions);
          filterPromises.push(exactMatchesPromise);
        }
      } else if (FilterUtility.isRangeFilter(propertyFilter)) {
        // `propertyFilter` is a `RangeFilter`
        const rangeMatchesPromise = this.filterRangeMatches(tenant, propertyName, propertyFilter, levelOptions);
        filterPromises.push(rangeMatchesPromise);
      }
    }

    // acting as an OR match for the property, any of the promises returning a match will be treated as a property match
    for (const promise of filterPromises) {
      // reminder: the promise returns a list of IndexedItem satisfying a particular property match
      for (const indexedItem of await promise) {
        // short circuit: if a data is already included to the final matched key set (by a different `Filter`),
        // no need to evaluate if the data satisfies this current filter being evaluated
        // otherwise check that the item is a match.
        if (matches.has(indexedItem.itemId) || !FilterUtility.matchItemIndexes(indexedItem.indexes, matchFilters)) {
          continue;
        }

        // ensure that each matched item has the sortProperty, otherwise fail the entire query.
        if (indexedItem.indexes[sortProperty] === undefined) {
          throw new DwnError(DwnErrorCode.IndexInvalidSortProperty, `invalid sort property ${sortProperty}`);
        }

        matches.set(indexedItem.itemId, indexedItem);
      }
    }
  }

  /**
   * Returns items that match the exact property and value.
   */
  private async filterExactMatches(
    tenant:string,
    propertyName: string,
    propertyValue: EqualFilter,
    options?: IndexLevelOptions
  ): Promise<IndexedItem[]> {

    const matchPrefix = IndexLevel.keySegmentJoin(FilterUtility.encodeValue(propertyValue));
    const iteratorOptions: LevelWrapperIteratorOptions<string> = {
      gt: matchPrefix
    };

    const tenantPartition = await this.db.partition(tenant);
    const filterPartition = await tenantPartition.partition(`__${propertyName}__`);
    const matches: IndexedItem[] = [];
    for await (const [ key, value ] of filterPartition.iterator(iteratorOptions, options)) {
      // immediately stop if we arrive at an index that contains a different property value
      if (!key.startsWith(matchPrefix)) {
        break;
      }
      matches.push(JSON.parse(value) as IndexedItem);
    }
    return matches;
  }

  /**
   * Returns items that match the range filter.
   */
  private async filterRangeMatches(
    tenant: string,
    propertyName: string,
    rangeFilter: RangeFilter,
    options?: IndexLevelOptions
  ): Promise<IndexedItem[]> {
    const iteratorOptions: LevelWrapperIteratorOptions<string> = {};
    for (const comparator in rangeFilter) {
      const comparatorName = comparator as keyof RangeFilter;
      iteratorOptions[comparatorName] = FilterUtility.encodeValue(rangeFilter[comparatorName]!);
    }

    // if there is no lower bound specified (`gt` or `gte`), we need to iterate from the upper bound,
    // so that we will iterate over all the matches before hitting mismatches.
    if (iteratorOptions.gt === undefined && iteratorOptions.gte === undefined) {
      iteratorOptions.reverse = true;
    }

    const matches: IndexedItem[] = [];
    const tenantPartition = await this.db.partition(tenant);
    const filterPartition = await tenantPartition.partition(`__${propertyName}__`);

    for await (const [ key, value ] of filterPartition.iterator(iteratorOptions, options)) {
      // if "greater-than" is specified, skip all keys that contains the exact value given in the "greater-than" condition
      if ('gt' in rangeFilter && this.extractIndexValueFromKey(key) === FilterUtility.encodeValue(rangeFilter.gt!)) {
        continue;
      }
      matches.push(JSON.parse(value) as IndexedItem);
    }

    if ('lte' in rangeFilter) {
      // When `lte` is used, we must also query the exact match explicitly because the exact match will not be included in the iterator above.
      // This is due to the extra data appended to the (property + value) key prefix, e.g.
      // the key '"2023-05-25T11:22:33.000000Z"\u0000bayfreigu....'
      // would be considered greater than { lte: '"2023-05-25T11:22:33.000000Z"` } used in the iterator options,
      // thus would not be included in the iterator even though we'd like it to be.
      for (const item of await this.filterExactMatches(tenant, propertyName, rangeFilter.lte as EqualFilter, options)) {
        matches.push(item);
      }
    }

    return matches;
  }

  /**
   * Sorts Items lexicographically in ascending or descending order given a specific sortProperty, using the itemId as a tie breaker.
   * We know the indexes include the sortProperty here because they have already been checked within executeSingleFilterQuery.
   */
  private sortItems(itemA: IndexedItem, itemB: IndexedItem, sortProperty: string, direction: SortDirection): number {
    const aValue = FilterUtility.encodeValue(itemA.indexes[sortProperty]) + itemA.itemId;
    const bValue = FilterUtility.encodeValue(itemB.indexes[sortProperty]) + itemB.itemId;
    return direction === SortDirection.Ascending ?
      lexicographicalCompare(aValue, bValue) :
      lexicographicalCompare(bValue, aValue);
  }

  /**
   * Gets the indexes given an itemId. This is a reverse lookup to construct starting keys, as well as deleting indexed items.
   */
  private async getIndexes(tenant: string, itemId: string): Promise<Indexes|undefined> {
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
   * Given a key from an indexed partitioned property key.
   *  ex:
   *    key: '"2023-05-25T11:22:33.000000Z"\u0000bayfreigu....'
   *    returns "2023-05-25T11:22:33.000000Z"
   */
  private extractIndexValueFromKey(key: string): string {
    const [value] = key.split(IndexLevel.delimiter);
    return value;
  }

  /**
   * Joins the given values using the `\x00` (\u0000) character.
   */
  private static delimiter = `\x00`;
  private static keySegmentJoin(...values: unknown[]): string {
    return values.join(IndexLevel.delimiter);
  }
}

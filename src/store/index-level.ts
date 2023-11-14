import type { EqualFilter, Filter, IndexedItem, Indexes, RangeFilter } from '../types/message-types.js';
import type { LevelWrapperBatchOperation, LevelWrapperIteratorOptions, } from './level-wrapper.js';

import { DwnInterfaceName } from '../index.js';
import { Index } from '../utils/index.js';
import { lexicographicalCompare } from '../utils/string.js';
import { SortDirection } from '../types/message-types.js';
import { createLevelDatabase, LevelWrapper } from './level-wrapper.js';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';
import { flatten, isEmptyObject, removeUndefinedProperties } from '../utils/object.js';

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
    options?: IndexLevelOptions
  ): Promise<void> {
    // flatten any indexable properties remove undefined and make sure indexable properties exist.
    indexes = flatten(indexes) as Indexes;
    removeUndefinedProperties(indexes);
    if (isEmptyObject(indexes)) {
      throw new Error('must include at least one indexable property');
    }

    const tenantPartition = await this.db.partition(tenant);
    const indexOps: LevelWrapperBatchOperation<string>[] = [];

    // use each index value as a sortable property
    for (const sortProperty in indexes) {
      const sortValue = indexes[sortProperty];
      // the key is sortValue followed by the itemId as a tie-breaker.
      // for example if the property is messageTimestamp the key would look like:
      //  '"2023-05-25T18:23:29.425008Z"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      //
      const key = IndexLevel.keySegmentJoin(Index.encodeValue(sortValue), itemId);
      const itemValue: IndexedItem<T> = { itemId: itemId, indexes, value };

      // we write the values into a sublevel-partition of tenantPartition.
      // we wrap it in __${sortProperty}__ so that it does not clash with other sublevels ie "index"
      // putting each property within a sublevel allows the levelDB system to calculate a gt minKey and lt maxKey for each of the properties
      // this prevents them from clashing, especially when iterating in reverse without iterating through other properties.
      indexOps.push(tenantPartition.partitionOperation(`__${sortProperty}__`, {
        key,
        type  : 'put',
        value : JSON.stringify(itemValue)
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
        key  : IndexLevel.keySegmentJoin(Index.encodeValue(sortValue), itemId),
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
  */
  async query(tenant: string, filters: Filter[], queryOptions: QueryOptions, options?: IndexLevelOptions): Promise<T[]> {
    const { cursor } = queryOptions;

    // returns an array of which search filters we need to perform a full search on.
    // if there are no search filters returned, we do a full scan on the sorted index.
    const searchFilters = await this.searchFilterSelector(filters, cursor !== undefined);
    if (searchFilters.length === 0) {
      return this.sortedIndexQuery(tenant, filters, queryOptions, options);
    }

    return this.filteredIndexQuery(tenant, filters, searchFilters, queryOptions, options);
  }

  /**
   * Helps select which filter properties are needed to build a filtered query for the LevelDB indexes.
   *
   * @param filters the array of filters from an incoming query.
   * @param hasCursor whether or not the incoming query has a cursor.
   * @returns an array of filters to query using. If an empty array is returned, query using the sort property index.
   */
  private async searchFilterSelector(filters: Filter[], hasCursor: boolean = false): Promise<Filter[]> {

    // first we check if a cursor point exists and are querying for Events in any of the filters,
    // we want to do a sorted index query by the watermark so we return no search filters
    if (hasCursor && filters.findIndex(({ interface: interfaceName }) => {
      return Index.isEqualFilter(interfaceName) && interfaceName === DwnInterfaceName.Events ||
      Index.isOneOfFilter(interfaceName) && interfaceName.includes(DwnInterfaceName.Events);
    }) > -1) {
      return [];
    }

    const searchFilters: Filter[] = [];
    // next we determine if any of the filters contain a specific identifier such as recordId or permissionsGrantId
    // if that's the case it's always the only property for the specific filter it's a member of
    for (const filter of filters) {
      const { recordId, permissionsGrantId } = filter;
      // we don't use range filters with these, so either Equality or OneOf filters should be used
      if (recordId !== undefined && (Index.isEqualFilter(recordId) || Index.isOneOfFilter(recordId))) {
        searchFilters.push({ recordId });
      }

      if (permissionsGrantId !== undefined && (Index.isEqualFilter(permissionsGrantId) || Index.isOneOfFilter(permissionsGrantId))) {
        searchFilters.push({ permissionsGrantId });
      }
    }

    // we remove the filters that had recordId filters, as those filters will only use the recordId for a match
    const remainingFilters = filters.filter(filter => filter.recordId === undefined);

    // now we determine if the remaining filters array has any common filters.
    // If there is a match, it's likely best to run a single query against that filter.
    const { schema, contextId, protocol, protocolPath } = IndexLevel.commonFilters(remainingFilters);
    if (contextId !== undefined && Index.isEqualFilter(contextId)) {
      // a common contextId exists between all filters
      // we return this first, as it will likely produce the smallest match set.
      searchFilters.push({ contextId });
      return searchFilters;
    } else if ( schema !== undefined && Index.isEqualFilter(schema)) {
      // a common schema exists between all filters
      // we return this second, as it will likely produce a sufficiently small match set.
      searchFilters.push({ schema });
      return searchFilters;
    } else if (protocolPath !== undefined && Index.isEqualFilter(protocolPath)) {
      // a common protocol exists between all filters
      // we return this third, as it will likely produce a sufficiently small match set.
      searchFilters.push({ protocolPath });
      return searchFilters;
    } else if (protocol !== undefined && Index.isEqualFilter(protocol)) {
      // a common protocol exists between all filters
      // we return this third, as it will likely produce a sufficiently small match set.
      searchFilters.push({ protocol });
      return searchFilters;
    };


    // if we found no common filters, we will attempt to find context, schema, or protocol of each filter
    const finalFilters: Filter[] = remainingFilters.map(({ contextId, schema, protocol, protocolPath }) => {
      // if check for single equality filters first in order of most likely to have a smaller set
      if (contextId !== undefined && Index.isEqualFilter(contextId)) {
        return { contextId } as Filter;
      } else if (schema !== undefined && Index.isEqualFilter(schema)) {
        return { schema } as Filter;
      } else if (protocolPath !== undefined && Index.isEqualFilter(protocolPath)) {
        return { protocolPath } as Filter;
      } else if (protocol !== undefined && Index.isEqualFilter(protocol)) {
        return { protocol } as Filter;
      }

      // check for OneOf filters next
      if (contextId !== undefined && Index.isOneOfFilter(contextId)) {
        return { contextId } as Filter;
      } else if (schema !== undefined && Index.isOneOfFilter(schema)) {
        return { schema } as Filter;
      } else if (protocolPath !== undefined && Index.isOneOfFilter(protocolPath)) {
        return { protocol } as Filter;
      } else if (protocol !== undefined && Index.isOneOfFilter(protocol)) {
        return { protocolPath } as Filter;
      }

      // we return an empty filter and check for it to
      return { };
    });

    // if we have an empty filter, we will query based on the sort property, so we return an empty set of filters.
    if (finalFilters.findIndex(filter => isEmptyObject(filter)) > -1) {
      return [];
    }

    return [ ...finalFilters, ...searchFilters];
  }

  /**
   * Queries the sort property index for items that match the filters. If no filters are provided, all items are returned.
   * This query is a linear iterator over the sorted index, checking each item for a match.
   * If a cursor is provided it starts the iteration at the cursor point.
   */
  async sortedIndexQuery(tenant: string, filters: Filter[], queryOptions: QueryOptions, options?: IndexLevelOptions): Promise<T[]> {
    const { limit } = queryOptions;
    const matches: Array<T> = [];
    for await ( const item of this.sortedIndexIterator(tenant, filters, queryOptions, options)) {
      if (limit !== undefined && matches.length === limit) {
        return matches;
      }
      if (this.matchItem(item, filters)) {
        matches.push(item.value);
      }
    }
    return matches;
  }

  /**
   * Iterates through each sorted index item given a specific sortProperty.
   * If a cursor is passed, the starting value (gt or lt) is derived from that.
   */
  private async * sortedIndexIterator(
    tenant: string, filters: Filter[], queryOptions: QueryOptions, options?: IndexLevelOptions
  ): AsyncGenerator<IndexedItem<T>> {
    const { sortProperty, sortDirection = SortDirection.Ascending, cursor } = queryOptions;

    // if there is a cursor we fetch the starting key given the sort property, otherwise we start from the beginning of the index.
    const startKey = cursor ? await this.getStartingKeyForCursor(tenant, cursor, sortProperty, filters) : '';
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

    const tenantPartition = await this.db.partition(tenant);
    const sortPartition = await tenantPartition.partition(`__${sortProperty}__`);
    for await (const [ _, val ] of sortPartition.iterator(iteratorOptions, options)) {
      const { value, indexes, itemId } = JSON.parse(val);
      yield { value, indexes, itemId };
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

    // cursor indexes must match the provided filters to be valid.
    if (Index.matchItem(sortIndexes, filters)) {
      return IndexLevel.keySegmentJoin(Index.encodeValue(sortValue), itemId);
    }
  }

  /**
   * Queries the provided searchFilters asynchronously, returning results that match the matchFilters.
   *
   * @param matchFilters the filters passed to the parent query.
   * @param searchFilters the modified filters used for the LevelDB query to search for a subset of items to match against.
   */
  private async filteredIndexQuery(
    tenant: string,
    matchFilters: Filter[],
    searchFilters:Filter[],
    queryOptions: QueryOptions,
    options?: IndexLevelOptions
  ): Promise<T[]> {
    const { sortProperty, sortDirection = SortDirection.Ascending, cursor, limit } = queryOptions;
    const matches:Map<string, IndexedItem<T>> = new Map();

    await Promise.all(searchFilters.map(filter => {
      return this.executeSingleFilterQuery(tenant, filter, matchFilters, sortProperty, matches, options );
    }));

    const matchedValues = [...matches.values()];
    matchedValues.sort((a,b) => this.sortItems(a,b, sortProperty, sortDirection));
    const cursorIndex = matchedValues.findIndex(match => match.itemId === cursor);
    const start = cursorIndex > -1 ? cursorIndex + 1 : 0;
    const end = limit !== undefined ? start + limit : undefined;

    return matchedValues.slice(start, end).map(match => match.value);
  }

  /**
   * Execute a query against a single filter and return all results.
   */
  private async executeSingleFilterQuery(
    tenant: string,
    searchFilter: Filter,
    matchFilters: Filter[],
    sortProperty: string,
    matches: Map<string, IndexedItem<T>>,
    levelOptions?: IndexLevelOptions
  ): Promise<void> {
    // Note: We have an array of Promises in order to support OR (anyOf) matches when given a list of accepted values for a property
    const filterPromises: Promise<IndexedItem<T>[]>[] = [];

    for (const propertyName in searchFilter) {
      const propertyFilter = searchFilter[propertyName];
      // We will find the union of these many individual queries later.
      if (Index.isEqualFilter(propertyFilter)) {
        // propertyFilter is an EqualFilter, meaning it is a non-object primitive type
        const exactMatchesPromise = this.filterExactMatches(tenant, propertyName, propertyFilter, levelOptions);
        filterPromises.push(exactMatchesPromise);
      } else if (Index.isOneOfFilter(propertyFilter)) {
        // `propertyFilter` is a OneOfFilter
        // Support OR matches by querying for each values separately,
        // then adding them to the promises associated with `propertyName`
        for (const propertyValue of new Set(propertyFilter)) {
          const exactMatchesPromise = this.filterExactMatches(tenant, propertyName, propertyValue, levelOptions);
          filterPromises.push(exactMatchesPromise);
        }
      } else if (Index.isRangeFilter(propertyFilter)) {
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
        if (matches.has(indexedItem.itemId)) {
          continue;
        }

        if (!this.matchItem(indexedItem, matchFilters)) {
          continue;
        }

        // if first time seeing a property matching for the data/object, record all properties needing a match to track progress
        if (indexedItem.indexes[sortProperty] === undefined) {
          throw new DwnError(DwnErrorCode.IndexInvalidSortProperty, `invalid sort property ${sortProperty}`);
        }

        matches.set(indexedItem.itemId, indexedItem);
      }
    }
  }

  private async filterExactMatches(
    tenant:string,
    propertyName: string,
    propertyValue: EqualFilter,
    options?: IndexLevelOptions
  ): Promise<IndexedItem<T>[]> {

    const matchPrefix = IndexLevel.keySegmentJoin(Index.encodeValue(propertyValue));
    const iteratorOptions: LevelWrapperIteratorOptions<string> = {
      gt: matchPrefix
    };

    const tenantPartition = await this.db.partition(tenant);
    const filterPartition = await tenantPartition.partition(`__${propertyName}__`);
    const matches: IndexedItem<T>[] = [];
    for await (const [ key, value ] of filterPartition.iterator(iteratorOptions, options)) {
      // immediately stop if we arrive at an index that contains a different property value
      if (!key.startsWith(matchPrefix)) {
        break;
      }
      matches.push(JSON.parse(value) as IndexedItem<T>);
    }
    return matches;
  }

  private async filterRangeMatches(
    tenant: string,
    propertyName: string,
    rangeFilter: RangeFilter,
    options?: IndexLevelOptions
  ): Promise<IndexedItem<T>[]> {
    const iteratorOptions: LevelWrapperIteratorOptions<string> = {};
    for (const comparator in rangeFilter) {
      const comparatorName = comparator as keyof RangeFilter;
      iteratorOptions[comparatorName] = Index.encodeValue(rangeFilter[comparatorName]!);
    }

    // if there is no lower bound specified (`gt` or `gte`), we need to iterate from the upper bound,
    // so that we will iterate over all the matches before hitting mismatches.
    if (iteratorOptions.gt === undefined && iteratorOptions.gte === undefined) {
      iteratorOptions.reverse = true;
    }

    const matches: IndexedItem<T>[] = [];
    const tenantPartition = await this.db.partition(tenant);
    const filterPartition = await tenantPartition.partition(`__${propertyName}__`);

    for await (const [ key, value ] of filterPartition.iterator(iteratorOptions, options)) {
      // if "greater-than" is specified, skip all keys that contains the exact value given in the "greater-than" condition
      if ('gt' in rangeFilter && this.extractIndexValueFromKey(key) === Index.encodeValue(rangeFilter.gt!)) {
        continue;
      }
      matches.push(JSON.parse(value) as IndexedItem<T>);
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

  private matchItem(item: IndexedItem<T>, filters: Filter[]): boolean {
    const { indexes } = item;
    return Index.matchItem(indexes, filters);
  }

  private static commonFilters(filters: Filter[]): Filter {
    if (filters.length === 0) {
      return { };
    }
    return filters.reduce((prev, current) => {
      const filterCopy = { ...prev };
      for (const property in filterCopy) {
        const filterValue = filterCopy[property];
        const compareValue = current[property];
        if (Index.encodeValue(compareValue) !== Index.encodeValue(filterValue)) {
          delete filterCopy[property];
        }
      }
      return filterCopy;
    });
  }

  private sortItems(itemA: IndexedItem<T>, itemB: IndexedItem<T>, sortProperty: string, direction: SortDirection): number {
    const aValue = Index.encodeValue(itemA.indexes[sortProperty]) + itemA.itemId;
    const bValue = Index.encodeValue(itemB.indexes[sortProperty]) + itemB.itemId;
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
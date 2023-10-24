import type { FilteredQuery } from '../types/event-log.js';
import type { LevelWrapper } from './level-wrapper.js';
import type { EqualFilter, Filter, OneOfFilter, RangeFilter } from '../types/message-types.js';
import type { LevelWrapperBatchOperation, LevelWrapperIteratorOptions } from './level-wrapper.js';

import { flatten } from '../utils/object.js';
import { SortOrder } from '../types/message-types.js';


type IndexedItem<T> = {
  id: string;
  value: T;
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
    indexes: { [key:string]: unknown },
    sortIndexes: { [key:string]: unknown },
    options?: IndexLevelOptions
  ): Promise<void> {
    // ensure sorted indexes are flat and exist
    sortIndexes = flatten(sortIndexes);
    if (!sortIndexes || Object.keys(sortIndexes).length === 0) {
      throw new Error('must include at least one sorted index');
    }

    // ensure indexable properties exist
    indexes = flatten(indexes);
    if (!indexes || Object.keys(indexes).length === 0) {
      throw new Error('must include at least one indexable property');
    }

    const indexOps: LevelWrapperBatchOperation<string>[] = [];
    // adding a reverse lookup to be able to delete index data as well as look up sorted indexes by a cursor
    indexOps.push({ type: 'put', key: `__${itemId}__indexes`, value: JSON.stringify({ indexes, sortIndexes }) });

    // for each indexable property we go through the different sorting indexes and construct a sorted index key.
    // the sort property is the last property in the key before the tie-breaker.
    // the itemId itself is used as a tie-breaker in sorting as well as a truly unique sorted key.
    // for ex:
    //
    //  sortProperty  : 'watermark'
    //  sortValue     : '01HCG7W7P6WBC88WRKKYPN1Z9J'
    //  propertyName  : 'dateCreated'
    //  propertyValue : '2023-01-10T00:00:00.000000'
    //  itemId        : 'bafyreigup3ymvwjik3qadcrrshrsehedxgjhlya75qh5oexqelnsto2bpu'
    //  watermark\u0000dateCreated\u0000"2023-01-10T00:00:00.000000"\u0000"01HCG7W7P6WBC88WRKKYPN1Z9J"\u0000bafyreigu...
    //
    //  sortProperty  : 'messageTimestamp'
    //  sortValue     : '2023-01-10T00:00:00.000000'
    //  propertyName  : 'dateCreated'
    //  propertyValue : '2023-01-10T00:00:00.000000'
    //  itemId        : 'bafyreigup3ymvwjik3qadcrrshrsehedxgjhlya75qh5oexqelnsto2bpu'
    //  messageTimestamp\u0000dateCreated\u0000"2023-01-10T00:00:00.000000"\u0000"2023-01-10T00:00:00.000000"\u0000bafyreigu...

    for (const propertyName in indexes) {
      const propertyValue = indexes[propertyName];
      if (propertyValue !== undefined) {
        for (const sortProperty in sortIndexes) {
          const sortValue = sortIndexes[sortProperty];
          const sortedKey = this.constructIndexedKey(
            sortProperty,
            propertyName,
            this.encodeValue(propertyValue),
            this.encodeValue(sortValue),
            itemId,
          );
          indexOps.push({ type: 'put', key: sortedKey, value: JSON.stringify(value) });
        }
      }
    }

    const tenantPartition = await this.db.partition(tenant);
    const indexPartition = await tenantPartition.partition(INDEX_SUBLEVEL_NAME);
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

    const { indexes, sortIndexes } = JSON.parse(serializedIndexes);
    // delete the reverse lookup
    indexOps.push({ type: 'del', key: indexKey });

    // delete all indexes associated with the data of the given ID
    for (const propertyName in indexes) {
      const propertyValue = indexes[propertyName];
      for (const sortProperty in sortIndexes) {
        const sortValue = sortIndexes[sortProperty];
        const sortedKey = this.constructIndexedKey(
          sortProperty,
          propertyName,
          this.encodeValue(propertyValue),
          this.encodeValue(sortValue),
          itemId,
        );
        indexOps.push({ type: 'del', key: sortedKey });
      }
    }

    await indexPartition.batch(indexOps, options);
  }

  async query(tenant:string, queries: FilteredQuery[], options?: IndexLevelOptions): Promise<T[]> {
    const matched:Map<string, T> = new Map();
    await Promise.all(queries.map(query => this.executeSingleFilterQuery(tenant, query, matched, options)));
    return [...matched.values()];
  }

  async executeSingleFilterQuery(tenant:string, query: FilteredQuery, matches: Map<string, T>, options?: IndexLevelOptions): Promise<void> {
    const { filter, sortProperty , sortDirection, cursor } = query;

    // get beginning points for the cursor if provided.
    // returns undefined if cursor is defined but could not fetch the necessary information.
    // this is usually an invalid cursor. In this case we return zero results.
    const propertyCursors = await this.getFilterCursors(tenant, filter, sortProperty, cursor);
    if (propertyCursors === undefined) {
      return;
    }

    // Note: We have an array of Promises in order to support OR (anyOf) matches when given a list of accepted values for a property
    const propertyNameToPromises: { [key: string]: Promise<IndexedItem<T>[]>[] } = {};

    // Do a separate DB query for each property in `filter`
    // We will find the union of these many individual queries later.
    for (const propertyName in filter) {
      const propertyFilter = filter[propertyName];
      if (typeof propertyFilter === 'object') {
        if (Array.isArray(propertyFilter)) {
          // `propertyFilter` is a OneOfFilter
          // if OneOfFilter, the cursor properties are a map of each individual EqualFilter and the associated cursor string
          const cursorMap = propertyCursors[propertyName] as Map<EqualFilter, string>|undefined;

          // Support OR matches by querying for each values separately,
          // then adding them to the promises associated with `propertyName`
          propertyNameToPromises[propertyName] = [];
          for (const propertyValue of new Set(propertyFilter)) {
            const cursor = cursorMap ? cursorMap.get(propertyValue) : undefined;
            const exactMatchesPromise = this.findExactMatches(tenant, propertyName, propertyValue, sortProperty, sortDirection, cursor, options);
            propertyNameToPromises[propertyName].push(exactMatchesPromise);
          }
        } else {
          // `propertyFilter` is a `RangeFilter`
          // if RangeFilter use the string curser associated with the `propertyName`
          const cursor = propertyCursors[propertyName] as string | undefined;
          const rangeMatchesPromise = this.findRangeMatches(tenant, propertyName, propertyFilter, sortProperty, sortDirection, cursor, options);
          propertyNameToPromises[propertyName] = [rangeMatchesPromise];
        }
      } else {
        // propertyFilter is an EqualFilter, meaning it is a non-object primitive type
        // if EqualFilter use the string cursor associated with the `propertyName`
        const cursor = propertyCursors[propertyName] as string | undefined;
        const exactMatchesPromise = this.findExactMatches(tenant, propertyName, propertyFilter, sortProperty, sortDirection, cursor, options);
        propertyNameToPromises[propertyName] = [exactMatchesPromise];
      }
    }

    // map of keys of all data/object -> list of missing property matches
    // if count of missing property matches is 0, it means the data/object fully matches the filter
    const missingPropertyMatchesForId: { [key: string]: Set<string> } = { };

    // resolve promises for each property match and
    // eliminate matched property from `missingPropertyMatchesForId` iteratively to work out complete matches
    for (const [propertyName, promises] of Object.entries(propertyNameToPromises)) {
      // acting as an OR match for the property, any of the promises returning a match will be treated as a property match
      for (const promise of promises) {
        // reminder: the promise returns a list of IndexValue objects (with unique key and value) of data satisfying a particular match
        for (const sortableValue of await promise) {
          // short circuit: if a data is already included to the final matched key set (by a different `Filter`),
          // no need to evaluate if the data satisfies this current filter being evaluated
          if (matches.has(sortableValue.id)) {
            continue;
          }

          // if first time seeing a property matching for the data/object, record all properties needing a match to track progress
          missingPropertyMatchesForId[sortableValue.id] ??= new Set<string>([ ...Object.keys(filter) ]);
          missingPropertyMatchesForId[sortableValue.id].delete(propertyName);
          if (missingPropertyMatchesForId[sortableValue.id].size === 0) {
            // full filter match, add it to return list
            matches.set(sortableValue.id, sortableValue.value);
          }
        }
      }
    }
  }

  private async findExactMatches(
    tenant:string,
    propertyName: string,
    propertyValue: unknown,
    sortProperty: string,
    sortDirection: SortOrder,
    cursor?: string,
    options?: IndexLevelOptions
  ): Promise<IndexedItem<T>[]> {
    const tenantPartition = await this.db.partition(tenant);
    const indexPartition = await tenantPartition.partition(INDEX_SUBLEVEL_NAME);

    const matchPrefix = this.constructIndexedKey(sortProperty, propertyName, this.encodeValue(propertyValue));
    const iteratorOptions: LevelWrapperIteratorOptions<string> = {
      gt: matchPrefix
    };

    // if a cursor is defined we want to set it as the starting point for the query.
    if (cursor !== undefined) {
      iteratorOptions.gt = cursor;
    }

    const matches: IndexedItem<T>[] = [];
    for await (const [ key, value ] of indexPartition.iterator(iteratorOptions, options)) {
      // immediately stop if we arrive at an index that contains a different property
      if (!key.startsWith(matchPrefix)) {
        break;
      }

      const itemId = this.extractItemId(key);
      matches.push({ id: itemId, value: JSON.parse(value) });
    }

    if (sortDirection !== SortOrder.Ascending) {
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
    cursor?: string,
    options?: IndexLevelOptions
  ): Promise<IndexedItem<T>[]> {
    const tenantPartition = await this.db.partition(tenant);
    const indexPartition = await tenantPartition.partition(INDEX_SUBLEVEL_NAME);
    const iteratorOptions: LevelWrapperIteratorOptions<string> = {};
    const matchPrefix = this.constructIndexedKey(sortProperty, propertyName);

    for (const comparator in rangeFilter) {
      const comparatorName = comparator as keyof RangeFilter;
      iteratorOptions[comparatorName] = this.constructIndexedKey(sortProperty, propertyName, this.encodeValue(rangeFilter[comparatorName]));
    }

    // if a cursor exists, it will be the starting point for the range query but not equal to.
    if (cursor !== undefined) {
      iteratorOptions.gt = cursor;
      delete iteratorOptions.gte;
    }

    // if there is no lower bound specified (`gt` or `gte`), we need to iterate from the upper bound,
    // so that we will iterate over all the matches before hitting mismatches.
    if (iteratorOptions.gt === undefined && iteratorOptions.gte === undefined) {
      iteratorOptions.reverse = true;
    }

    const matches: IndexedItem<T>[] = [];

    for await (const [ key, value ] of indexPartition.iterator(iteratorOptions, options)) {
      // if "greater-than" is specified, skip all keys that contains the exact value given in the "greater-than" condition
      if ('gt' in rangeFilter && this.extractValueFromKey(key) === this.encodeValue(rangeFilter.gt)) {
        continue;
      }

      // immediately stop if we arrive at an index entry for a different property
      if (!key.startsWith(matchPrefix)) {
        break;
      }

      const itemId = this.extractItemId(key);
      matches.push({ id: itemId, value: JSON.parse(value) });
    }

    // we gather the lte matches separately to include before or after the results depending on the sort.
    const lteMatches:IndexedItem<T>[] = [];
    if ('lte' in rangeFilter) {
      // When `lte` is used, we must also query the exact match explicitly because the exact match will not be included in the iterator above.
      // This is due to the extra data appended to the (property + value) key prefix, e.g.
      // the key 'watermark\u0000dateCreated\u0000"2023-05-25T11:22:33.000000Z"\u000001HBY2E1TPY1W95SE0PEG2AM96\u0000bayfreigu....'
      // would be considered greater than { lte: 'watermark\u0000dateCreated\u0000"2023-05-25T11:22:33.000000Z"` } used in the iterator options,
      // thus would not be included in the iterator even though we'd like it to be.
      //
      // we also only include the cursor ONLY if it is relevant to the exact property in the 'lte' filter.
      const lteCursor = cursor && this.extractValueFromKey(cursor) === this.encodeValue(rangeFilter.lte) ? cursor : undefined;
      for (const item of await this.findExactMatches(tenant, propertyName, rangeFilter.lte, sortProperty, sortDirection, lteCursor, options)) {
        lteMatches.push(item);
      }
    }

    // if the iterator is reversed and the results should be in Ascending order, we reverse the iterated matches.
    // if the iterator is not reversed and the results should be in Descending order, we also reverse the iterated matches.
    if ((iteratorOptions.reverse === true && sortDirection === SortOrder.Ascending) ||
      (iteratorOptions.reverse !== true && sortDirection === SortOrder.Descending)) {
      matches.reverse();
    }

    // the 'lteMatches' are already sorted, but depending on the sort we add them before or after the range matches.
    if (sortDirection === SortOrder.Ascending) {
      return [...matches, ...lteMatches];
    } else {
      return [...lteMatches, ...matches];
    }
  }

  /**
   * Construct a sortable index key to be used for each individual property of an indexed item.
   * Although all of the properties are required to construct the key when inserting, we also use this function for creating a prefix.
   *
   * ex: sortProperty\u0000propertyName\u0000[propertyValue]\u0000[sortValue]\u0000[key]
   *
   * @param sortProperty the sorting property to construct the prefix of the key.
   * @param propertyName the specific property name being indexed.
   * @param propertyValue the optional specific property value being indexed.
   * @param sortValue the optional value that determines the sort order in a lexicographical sorted way
   * @param key the optional unique key of the item being indexed, this is used as a tiebreaker in case the other properties are the same.
   * @returns a key to be used for sorted indexing within the LevelDB Index.
   */
  protected constructIndexedKey(sortProperty: string, propertyName: string, propertyValue?: string, sortValue?: string, key?: string): string {
    const keyConstruction = [ sortProperty, propertyName ];
    if (propertyValue !== undefined) {
      keyConstruction.push(propertyValue);
    }

    if (sortValue !== undefined) {
      keyConstruction.push(sortValue);
    }
    if (key !== undefined) {
      keyConstruction.push(key);
    }

    return IndexLevel.join(...keyConstruction);
  }

  async getFilterCursors(
    tenant: string,
    filters: Filter,
    sortProperty: string,
    cursor?: string
  ): Promise<{ [key:string]: string | Map<EqualFilter, string> } | undefined> {
    const tenantPartition = await this.db.partition(tenant);
    const indexPartition = await tenantPartition.partition(INDEX_SUBLEVEL_NAME);
    const propertyCursors: { [key:string]:string | Map<EqualFilter, string>} = {};

    // if cursor is undefined return empty property cursors;
    if (cursor === undefined) {
      return { };
    }

    // if we don't find any index data we return undefined so that we can return zero results
    const serializedIndexes = await indexPartition.get(`__${cursor}__indexes`);
    if (serializedIndexes === undefined) {
      return;
    }

    const { sortIndexes, indexes } = JSON.parse(serializedIndexes);
    const sortValue = sortIndexes[sortProperty];
    // construct the starting points for each individual property within the filter.
    for (const filterName in filters) {
      const filterValue = filters[filterName];
      const indexedValue = indexes[filterName];
      propertyCursors[filterName] = this.extractCursorValue(cursor, filterName, filterValue, sortProperty, sortValue, indexedValue);
    }

    return propertyCursors;
  }

  /**
   * Extracts the specific indexed key a a 'gt' starting point values for each filtered property.
   *
   * @param cursor the unique key of the item that was used to index
   * @param propertyName the indexed property name.
   * @param propertyFilter the filter value to extract a value from.
   * @param sortProperty the sort property to use for creating the starting key.
   * @param sortValue the sort value to use when creating the starting key.
   * @param indexedValue the property value for this specific cursor to be used.
   * @returns a string starting value 'gt' to use within a query, or a Map of them for a OneOfFilter.
   */
  private extractCursorValue(
    cursor: string,
    propertyName: string,
    propertyFilter: EqualFilter | OneOfFilter | RangeFilter,
    sortProperty: string,
    sortValue: string,
    indexedValue: unknown
  ): string | Map<EqualFilter,string> {
    let value : unknown;

    if (typeof propertyFilter !== 'object') {
      // if filter is not an object, it's of type string | number | boolean
      // this is an exact filter. In this case we are matching for the propertyFilter exactly.
      // the sort value is what determines the starting point.
      value = propertyFilter;
    } else {
      if (!Array.isArray(propertyFilter)) {
        // if it's not an array, it is a range filter.
        // the property value for the cursor should come from the indexes for the specific cursor
        value = indexedValue;
      } else {
        // if the filter is an array it is an OR filter and will be treated like multiple exact filters.
        // we create a map of propertyValue to cursor key for each individual propertyValue for retrieval later.
        const values = new Map<EqualFilter, string>();
        for (const propertyValue of new Set(propertyFilter)) {
          values.set(propertyValue, this.constructIndexedKey(
            sortProperty,
            propertyName,
            this.encodeValue(propertyValue),
            this.encodeValue(sortValue),
            cursor
          ));
        }
        return values;
      }
    }

    return this.constructIndexedKey(
      sortProperty,
      propertyName,
      this.encodeValue(value),
      this.encodeValue(sortValue),
      cursor,
    );
  }

  /**
   * Extracts the value associated with the property encoded within the key during indexing.
   *  this is the third element in the key after splitting.
   *
   * ex:
   *  key - sortProperty\u0000propertyName\u0000__propertyValue__\u0000sortValue\u0000dataId
   *  returns __propertyValue__
   *
   * @param key the constructed key that is used in the Index.
   * @returns a string that represents the unique key used when indexing an item.
   */
  private extractValueFromKey(key: string): string {
    const [,,value] = key.split(IndexLevel.delimiter);
    return value;
  }

  /**
   * Extracts the unique data/item ID from a index key.
   *  this is the last element in the index key after splitting.
   *
   * ex:
   *  key - sortProperty\u0000propertyName\u0000propertyValue\u0000sortValue\u0000dataId
   *  returns dataId
   *
   * @param key the constructed key that is used in the Index.
   * @returns a string that represents the unique data ID of an indexed item.
   */
  private extractItemId(key: string): string {
    const [,,,,itemId] = key.split(IndexLevel.delimiter);
    return itemId;
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
      return IndexLevel.encodeNumberValue(value);
    default:
      return String(value);
    }
  }

  /**
   * Joins the given values using the `\x00` (\u0000) character.
   */
  protected static delimiter = `\x00`;
  protected static join(...values: unknown[]): string {
    return values.join(IndexLevel.delimiter);
  }
}
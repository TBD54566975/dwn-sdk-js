import type { EqualFilter, Filter, FilterValue, OneOfFilter, QueryOptions, RangeFilter } from '../types/query-types.js';

import { isEmptyObject } from './object.js';

/**
 * A Utility class to help match indexes against filters.
 */
export class FilterUtility {
  static matchItem(indexes: { [key:string]:unknown }, filters: Filter[]): boolean {
    if (filters.length === 0) {
      return true;
    }

    for (const filter of filters) {
      // if any of the filters match the indexed values, we return true as it's a match
      if (this.matchFilter(indexes, filter)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Evaluates the given filter against the indexed values retrieved from the DB.
   *
   * @param indexedValues the indexed values for an item retrieved from teh database.
   * @param filter
   * @returns true if all of the filter properties match.
   */
  private static matchFilter(indexedValues: { [key:string]:unknown }, filter: Filter): boolean {
    // set of unique query properties.
    // if count of missing property matches is 0, it means the data/object fully matches the filter
    const missingPropertyMatches: Set<string> = new Set([ ...Object.keys(filter) ]);

    for (const filterProperty in filter) {
      const filterValue = filter[filterProperty];
      const indexValue = indexedValues[filterProperty];
      if (indexValue === undefined) {
        return false;
      }

      if (typeof filterValue === 'object') {
        if (Array.isArray(filterValue)) {
          // if `filterValue` is an array, it is a OneOfFilter
          // Support OR matches by querying for each values separately,
          if (!this.matchOneOf(filterValue, indexValue)) {
            return false;
          }
          missingPropertyMatches.delete(filterProperty);
          continue;
        } else {
          // `filterValue` is a `RangeFilter`
          if (!this.matchRange(filterValue, indexValue)) {
            return false;
          }
          missingPropertyMatches.delete(filterProperty);
          continue;
        }
      } else {
        // filterValue is an EqualFilter, meaning it is a non-object primitive type
        if (FilterUtility.encodeValue(indexValue) !== FilterUtility.encodeValue(filterValue)) {
          return false;
        }
        missingPropertyMatches.delete(filterProperty);
        continue;
      }
    }
    return missingPropertyMatches.size === 0;
  }

  /**
   * Evaluates a OneOfFilter given an indexedValue extracted from the index.
   *
   * @param filter An array of EqualFilters. Treated as an OR.
   * @param indexedValue the indexed value being compared.
   * @returns true if any of the given filters match the indexedValue
   */
  private static matchOneOf(filter: OneOfFilter, indexedValue: unknown): boolean {
    for (const orFilterValue of filter) {
      if (FilterUtility.encodeValue(indexedValue) === FilterUtility.encodeValue(orFilterValue)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Evaluates if the given indexedValue is within the range given by the RangeFilter.
   *
   * @returns true if all of the range filter conditions are met.
   */
  private static matchRange(rangeFilter: RangeFilter, indexedValue: unknown): boolean {
    const filterConditions: Array<(value: string) => boolean> = [];
    for (const filterComparator in rangeFilter) {
      const comparatorName = filterComparator as keyof RangeFilter;
      const filterComparatorValue = rangeFilter[comparatorName]!;
      const encodedFilterValue = FilterUtility.encodeValue(filterComparatorValue);
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
    return filterConditions.every((c) => c(FilterUtility.encodeValue(indexedValue)));
  }

  /**
   * Encodes an indexed value to a string
   *
   * NOTE: we currently only use this for strings, numbers and booleans.
   * Objects are returned as "[object Object]".
   * Although this never happens maybe we should consider making this function, and those which call it, typed better.
   */
  static encodeValue(value: unknown): string {
    switch (typeof value) {
    case 'string':
      // We can't just `JSON.stringify` as that'll affect the sort order of strings.
      // For example, `'\x00'` becomes `'\\u0000'`.
      return `"${value}"`;
    case 'number':
      return this.encodeNumberValue(value);
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

  static isEqualFilter(filter: FilterValue): filter is EqualFilter {
    if (typeof filter !== 'object') {
      return true;
    }
    return false;
  }

  static isRangeFilter(filter: FilterValue): filter is RangeFilter {
    if (typeof filter === 'object' && !Array.isArray(filter)) {
      return 'gt' in filter || 'lt' in filter || 'lte' in filter || 'gte' in filter;
    };
    return false;
  }

  static isOneOfFilter(filter: FilterValue): filter is OneOfFilter {
    if (typeof filter === 'object' && Array.isArray(filter)) {
      return true;
    };
    return false;
  }
}

export class FilterSelector {

  private static hasCursorAndSortProperty(filters: Filter[], queryOptions: QueryOptions):boolean {
    const { cursor, sortProperty } = queryOptions;
    return cursor !== undefined &&
      (sortProperty === 'watermark' || filters.findIndex(filter => Object.keys(filter).map(property => property === sortProperty)) > -1);
  }

  private static checkRangeFilters(filters: Filter[]): Filter[] {
    return filters
      .filter(filter => Object.values(filter).findIndex(filterValue => FilterUtility.isRangeFilter(filterValue)) > -1)
      .map(filter => {
        const filterProperties = Object.keys(filter);
        const rangeFilterIndex = filterProperties.findIndex(propertyName => FilterUtility.isRangeFilter(filter[propertyName]));
        const propertyName = filterProperties[rangeFilterIndex];
        const rangeFilter:Filter = {};
        rangeFilter[propertyName] = filter[propertyName];
        return rangeFilter;
      });
  }

  //TODO: return a single filter, this may have to change where/how this method is used.
  private static checkForIdSearches(filters: Filter[]): { searchFilters: Filter[], remainingFilters: Filter[] } {
    const searchFilters: Filter[] = [];
    const remainingFilters: Filter[] = [];
    // next we determine if any of the filters contain a specific identifier such as recordId or permissionsGrantId
    // if that's the case it's always the only property for the specific filter it's a member of
    for (const filter of filters) {
      const { recordId, permissionsGrantId } = filter;
      // we don't use range filters with these, so either Equality or OneOf filters should be used
      if (recordId !== undefined && (FilterUtility.isEqualFilter(recordId) || FilterUtility.isOneOfFilter(recordId))) {
        searchFilters.push({ recordId });
        continue;
      }

      if (permissionsGrantId !== undefined && (FilterUtility.isEqualFilter(permissionsGrantId) || FilterUtility.isOneOfFilter(permissionsGrantId))) {
        searchFilters.push({ permissionsGrantId });
        continue;
      }

      remainingFilters.push(filter);
    }

    return { searchFilters, remainingFilters };
  }

  private static checkCommonFilters(filters: Filter[]): Filter | undefined {
    const { schema, contextId, protocol, protocolPath } = this.commonFilters(filters);

    // if we match any of these, we add them to our search filters and return immediately
    if (contextId !== undefined && FilterUtility.isEqualFilter(contextId)) {
      // a common contextId exists between all filters
      // we return this first, as it will likely produce the smallest match set.
      return { contextId };
    } else if ( schema !== undefined && FilterUtility.isEqualFilter(schema)) {
      // a common schema exists between all filters
      // we return this second, as it will likely produce a sufficiently small match set.
      return { schema };
    } else if (protocolPath !== undefined && FilterUtility.isEqualFilter(protocolPath)) {
      // a common protocol exists between all filters
      // we return this third, as it will likely produce a sufficiently small match set.
      return { protocolPath };
    } else if (protocol !== undefined && FilterUtility.isEqualFilter(protocol)) {
      // a common protocol exists between all filters
      // we return this third, as it will likely produce a sufficiently small match set.
      return { protocol };
    };
  }

  /**
   * Helps select which filter properties are needed to build a filtered query for the LevelDB indexes.
   *
   * @param filters the array of filters from an incoming query.
   * @param queryOptions options associated with the incoming query.
   * @returns an array of filters to query using. If an empty array is returned, query using the sort property index.
   */
  static select(filters: Filter[], queryOptions: QueryOptions): Filter[] {

    // if we have a cursor and this is an EventsQuery (the only query that sorts by watermark), we want to trigger the sortedIndexQuery
    // we also trigger a sortedIndexQuery if we have a cursor and one of the filters is the same as the sortProperty
    if (this.hasCursorAndSortProperty(filters, queryOptions)) {
      return [];
    }

    // if the number of range filters that exist are equal to the number of filters in the query, we return the range filters.
    const rangeFilters = this.checkRangeFilters(filters);
    if (rangeFilters.length === filters.length) {
      return rangeFilters;
    }

    const { searchFilters, remainingFilters } = this.checkForIdSearches(filters);
    // now we determine if the remaining filters array has any common filters.
    // If there is a match, it's likely best to run a single query against that filter.
    const commonFilter = this.checkCommonFilters(remainingFilters);
    if (commonFilter !== undefined) {
      // the commonFilter was built from the remainingFilters from the checkForIdsSearch function
      // so we add the returned idFilters array, which could be empty, as well as the remaining common filter.
      return [ ...searchFilters, commonFilter ];
    }

    // if we found no common filters, we will attempt to find context, schema, or protocol of each filter
    const finalFilters: Filter[] = remainingFilters.map(({ contextId, schema, protocol, protocolPath }) => {
      // if check for single equality filters first in order of most likely to have a smaller set
      if (contextId !== undefined && FilterUtility.isEqualFilter(contextId)) {
        return { contextId } as Filter;
      } else if (schema !== undefined && FilterUtility.isEqualFilter(schema)) {
        return { schema } as Filter;
      } else if (protocolPath !== undefined && FilterUtility.isEqualFilter(protocolPath)) {
        return { protocolPath } as Filter;
      } else if (protocol !== undefined && FilterUtility.isEqualFilter(protocol)) {
        return { protocol } as Filter;
      }

      // check for OneOf filters next
      if (contextId !== undefined && FilterUtility.isOneOfFilter(contextId)) {
        return { contextId } as Filter;
      } else if (schema !== undefined && FilterUtility.isOneOfFilter(schema)) {
        return { schema } as Filter;
      } else if (protocolPath !== undefined && FilterUtility.isOneOfFilter(protocolPath)) {
        return { protocolPath } as Filter;
      } else if (protocol !== undefined && FilterUtility.isOneOfFilter(protocol)) {
        return { protocol } as Filter;
      }

      // we return an empty filter and check for it later
      return { };
    });

    // if we have an empty filter, we will query based on the sort property, so we return an empty set of filters.
    if (finalFilters.findIndex(filter => isEmptyObject(filter)) > -1) {
      return [];
    }

    return [ ...finalFilters, ...searchFilters];
  }


  /**
   * Given an array of filters, it returns a single filter with common property/values amongst all the filters.
   * If there are no common filters, the filter is empty.
   */
  private static commonFilters(filters: Filter[]): Filter {
    if (filters.length === 0) {
      return { };
    }
    return filters.reduce((prev, current) => {
      const filterCopy = { ...prev };
      for (const property in filterCopy) {
        const filterValue = filterCopy[property];
        const compareValue = current[property];
        if (FilterUtility.encodeValue(compareValue) !== FilterUtility.encodeValue(filterValue)) {
          delete filterCopy[property];
        }
      }
      return filterCopy;
    });
  }
}
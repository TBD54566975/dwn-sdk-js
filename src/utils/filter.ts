import type { EqualFilter, Filter, FilterValue, KeyValues, OneOfFilter, QueryOptions, RangeFilter } from '../types/query-types.js';

import { isEmptyObject } from './object.js';

/**
 * A Utility class to help match indexes against filters.
 */
export class FilterUtility {
  /**
   * Matches the given indexed values against an array of filters, if any of the filters match, returns true.
   *
   * @param indexedValues the indexed values for an item.
   * @returns true if any of the filters match.
   */
  static matchItemIndexes(indexedValues: KeyValues, filters: Filter[]): boolean {
    if (filters.length === 0) {
      return true;
    }

    for (const filter of filters) {
      // if any of the filters match the indexed values, we return true as it's a match
      if (this.matchFilter(indexedValues, filter)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Evaluates the given filter against the indexed values.
   *
   * @param indexedValues the indexed values for an item.
   * @param filter
   * @returns true if all of the filter properties match.
   */
  private static matchFilter(indexedValues: KeyValues, filter: Filter): boolean {
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
          // range filters cannot range over booleans
          if (typeof indexValue === 'boolean') {
            return false;
          }
          if (!this.matchRange(filterValue, indexValue)) {
            return false;
          }
          missingPropertyMatches.delete(filterProperty);
          continue;
        }
      } else {
        // filterValue is an EqualFilter, meaning it is a non-object primitive type
        if (indexValue !== filterValue) {
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
  private static matchOneOf(filter: OneOfFilter, indexedValue: string | number | boolean): boolean {
    for (const orFilterValue of filter) {
      if (indexedValue === orFilterValue) {
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
  private static matchRange(rangeFilter: RangeFilter, indexedValue: string | number): boolean {
    if (rangeFilter.lt !== undefined && indexedValue >= rangeFilter.lt) {
      return false;
    }
    if (rangeFilter.lte !== undefined && indexedValue > rangeFilter.lte) {
      return false;
    }
    if (rangeFilter.gt !== undefined && indexedValue <= rangeFilter.gt) {
      return false;
    }
    if (rangeFilter.gte !== undefined && indexedValue < rangeFilter.gte) {
      return false;
    }
    return true;
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
    const { schema, contextId, protocol, protocolPath } = this.commonEqualFilters(filters);

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
   * Given an array of filters, it returns a single filter with common EqualFilter per property.
   * If there are no common filters, the returned filter is empty.
   */
  private static commonEqualFilters(filters: Filter[]): Filter {
    if (filters.length === 0) {
      return { };
    }
    return filters.reduce((prev, current) => {
      const filterCopy = { ...prev };
      for (const property in filterCopy) {
        const filterValue = filterCopy[property];
        if (typeof filterValue !== 'object' && !Array.isArray(filterValue)) {
          const compareValue = current[property];
          if ( typeof compareValue !== 'object' && !Array.isArray(compareValue)) {
            if (compareValue !== filterValue) {
              delete filterCopy[property];
            }
          }
        } else {
          delete filterCopy[property];
        }
      }
      return filterCopy;
    });
  }
}
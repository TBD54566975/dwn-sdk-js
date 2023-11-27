import type { EqualFilter, Filter, FilterValue, KeyValues, OneOfFilter, RangeCriterion, RangeFilter, RangeValue } from '../types/query-types.js';

/**
 * A Utility class to help match indexes against filters.
 */
export class FilterUtility {
  /**
   * Matches the given key values against an array of filters, if any of the filters match, returns true.
   *
   * @returns true if any of the filters match.
   */
  static matchAnyFilter(keyValues: KeyValues, orFilters: Filter[]): boolean {
    if (orFilters.length === 0) {
      return true;
    }

    for (const filter of orFilters) {
      // if any of the filters match the indexed values, we return true as it's a match
      if (this.matchFilter(keyValues, filter)) {
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
          if (!this.matchRange(filterValue, indexValue as RangeValue)) {
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

  static convertRangeCriterion(inputFilter: RangeCriterion): RangeFilter | undefined {
    let rangeFilter: RangeFilter | undefined;
    if (inputFilter.to !== undefined && inputFilter.from !== undefined) {
      rangeFilter = {
        gte : inputFilter.from,
        lt  : inputFilter.to,
      };
    } else if (inputFilter.to !== undefined) {
      rangeFilter = {
        lt: inputFilter.to,
      };
    } else if (inputFilter.from !== undefined) {
      rangeFilter = {
        gte: inputFilter.from,
      };
    }
    return rangeFilter;
  }

}

export class FilterSelector {

  /**
   * Reduces an array of incoming Filters into an array of more efficient filters
   * The length of the returned Filters array is always less than or equal to that of the input filters array.
   */
  static reduceFilters(filters: Filter[]): Filter[] {

    // we extract any recordId filters and the remaining filters which do not have a recordId property
    const { idFilters, remainingFilters } = this.extractIdFilters(filters);
    // if there are no remaining filters, we only query by the idFilters
    if (remainingFilters.length === 0) {
      return idFilters;
    }

    const commonFilter = this.extractCommonFilter(remainingFilters);
    if (commonFilter !== undefined) {
      return [ ...idFilters, commonFilter ];
    }

    // extract any range filters from the remaining filters
    const { rangeFilters, remainingFilters: remainingAfterRange } = this.extractRangeFilters(remainingFilters);
    // if all of there are no remaining filters we return the RangeFilters along with any idFilters.
    if (remainingAfterRange.length === 0) {
      return [ ...idFilters, ...rangeFilters ];
    }

    const commonAfterRange = this.extractCommonFilter(remainingAfterRange);
    if (commonAfterRange !== undefined){
      return [ ...idFilters, ...rangeFilters, commonAfterRange ];
    }

    const finalRemaining = remainingAfterRange.map(filter => {

      const { contextId, schema, protocol, protocolPath, author, ...remaining } = filter;
      if (contextId !== undefined && FilterUtility.isEqualFilter(contextId)) {
        return { contextId };
      } else if (schema !== undefined && FilterUtility.isEqualFilter(schema)) {
        return { schema };
      } else if (protocolPath !== undefined && FilterUtility.isEqualFilter(protocolPath)) {
        return { protocolPath };
      } else if (protocol !== undefined && FilterUtility.isEqualFilter(protocol)) {
        return { protocol };
      } else if (author !== undefined && FilterUtility.isEqualFilter(author)) {
        return { author };
      } else {

        return this.getFirstFilterPropertyThatIsNotABooleanEqualFilter(filter) || remaining;
      }
    });

    return [ ...idFilters, ...rangeFilters, ...finalRemaining ];
  }

  /**
   * Extracts a single range filter from each of the input filters to return.
   * Naively chooses the first range filter it finds, this could be improved.
   *
   * @returns an array of Filters with each filter containing a single RangeFilter property.
   */
  private static extractRangeFilters(filters: Filter[]): { rangeFilters: Filter[], remainingFilters: Filter[] } {
    const rangeFilters: Filter[] = [];
    const remainingFilters: Filter[] = [];
    for (const filter of filters) {
      const filterKeys = Object.keys(filter);
      const rangeFilterKey = filterKeys.find(filterProperty => FilterUtility.isRangeFilter(filter[filterProperty]));
      if (rangeFilterKey === undefined) {
        remainingFilters.push(filter);
        continue;
      }
      const rangeFilter:Filter = {};
      rangeFilter[rangeFilterKey] = filter[rangeFilterKey];
      rangeFilters.push(rangeFilter);
    }
    return { rangeFilters, remainingFilters };
  }

  private static extractIdFilters(filters: Filter[]): { idFilters: Filter[], remainingFilters: Filter[] } {
    const idFilters: Filter[] = [];
    const remainingFilters: Filter[] = [];
    for (const filter of filters) {
      const { recordId } = filter;
      // we determine if any of the filters contain a recordId property;
      // we don't use range filters with these, so either Equality or OneOf filters should be used
      if (recordId !== undefined && (FilterUtility.isEqualFilter(recordId) || FilterUtility.isOneOfFilter(recordId))) {
        idFilters.push({ recordId });
        continue;
      }
      remainingFilters.push(filter);
    }

    return { idFilters: idFilters, remainingFilters };
  }

  private static extractCommonFilter(filters: Filter[]): Filter | undefined {
    const { schema, contextId, protocol, protocolPath, author, ...remaining } = this.commonEqualFilters(filters);

    // if we match any of these, we add them to our search filters and return immediately
    // the order we are checking/returning is the order of priority
    if (contextId !== undefined && FilterUtility.isEqualFilter(contextId)) {
      // a common contextId exists between all filters
      return { contextId };
    } else if ( schema !== undefined && FilterUtility.isEqualFilter(schema)) {
      // a common schema exists between all filters
      return { schema };
    } else if (protocolPath !== undefined && FilterUtility.isEqualFilter(protocolPath)) {
      // a common protocol exists between all filters
      return { protocolPath };
    } else if (protocol !== undefined && FilterUtility.isEqualFilter(protocol)) {
      // a common protocol exists between all filters
      return { protocol };
    } else if (author !== undefined && FilterUtility.isEqualFilter(author)) {
      // a common author exists between all filters
      return { author };
    }

    // return the first common filter that isn't listed in priority with a boolean common filter being last priority.
    return this.getFirstFilterPropertyThatIsNotABooleanEqualFilter(remaining);
  }

  private static getFirstFilterPropertyThatIsNotABooleanEqualFilter(filter: Filter): Filter | undefined {
    const filterProperties = Object.keys(filter);

    // find the first EqualFilter that is not a boolean
    const firstProperty = filterProperties.find(filterProperty => {
      const filterValue = filter[filterProperty];
      return filterValue !== undefined && FilterUtility.isEqualFilter(filterValue) && typeof filterValue !== 'boolean';
    });

    // if a non boolean filter exists, set it as the only filter property and return
    if (firstProperty !== undefined) {
      const singlePropertyFilter:Filter = {};
      singlePropertyFilter[firstProperty] = filter[firstProperty];
      return singlePropertyFilter;
    }

    return;
  }

  /**
   * Given an array of filters, it returns a single filter with common EqualFilter per property.
   * If there are no common filters, the returned filter is empty.
   */
  private static commonEqualFilters(filters: Filter[]): Filter {
    return filters.reduce((prev, current) => {
      const filterCopy = { ...prev };
      for (const property in filterCopy) {
        const filterValue = filterCopy[property];
        const compareValue = current[property];
        if (!FilterUtility.isEqualFilter(filterValue) || !FilterUtility.isEqualFilter(compareValue) || filterValue !== compareValue) {
          delete filterCopy[property];
        }
      }
      return filterCopy;
    });
  }
}
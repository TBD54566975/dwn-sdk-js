import type { EqualFilter, Filter, FilterValue, OneOfFilter, RangeFilter } from '../types/message-types.js';

/**
 * A Utility class to help match indexes against filters.
 */
export class FilterUtility {
  static matchItem(indexes: { [key:string]:unknown }, filters: Filter[]): boolean {
    if (filters.length === 0) {
      return true;
    }

    // todo: turn this into an async function?
    for (const filter of filters) {
      // if any of the filters match the indexed values, it is a match and move on to the next.
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
    const missingPropertyMatchesForIndex: Set<string> = new Set([ ...Object.keys(filter) ]);

    for (const filterProperty in filter) {
      const filterValue = filter[filterProperty];
      const indexValue = indexedValues[filterProperty];
      if (indexValue === undefined) {
        return false;
      }

      if (typeof filterValue === 'object') {
        if (Array.isArray(filterValue)) {
          // `propertyFilter` is a OneOfFilter
          // if OneOfFilter, the cursor properties are a map of each individual EqualFilter and the associated cursor string
          // Support OR matches by querying for each values separately,
          if (!this.matchOneOf(filterValue, indexValue)) {
            return false;
          }
          missingPropertyMatchesForIndex.delete(filterProperty);
          continue;
        } else {
          // `propertyFilter` is a `RangeFilter`
          // if RangeFilter use the string curser associated with the `propertyName`
          if (!this.matchRange(filterValue, indexValue)) {
            return false;
          }
          missingPropertyMatchesForIndex.delete(filterProperty);
          continue;
        }
      } else {
        // propertyFilter is an EqualFilter, meaning it is a non-object primitive type
        // if EqualFilter use the string cursor associated with the `propertyName`
        if (FilterUtility.encodeValue(indexValue) !== FilterUtility.encodeValue(filterValue)) {
          return false;
        }
        missingPropertyMatchesForIndex.delete(filterProperty);
        continue;
      }
    }
    return missingPropertyMatchesForIndex.size === 0;
  }

  /**
   * Evaluates a OneOfFilter given an indexedValue extracted from the index.
   *
   * @param filter An array of EqualityFilters. Treated as an OR.
   * @param indexedValue the indexed value being compared.
   * @returns true if any of the given filters match the indexedValue
   */
  private static matchOneOf(filter: OneOfFilter, indexedValue: unknown): boolean {
    for (const orFilterValue of new Set(filter)) {
      if (FilterUtility.encodeValue(indexedValue) === FilterUtility.encodeValue(orFilterValue)) {
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
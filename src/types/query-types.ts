export type QueryOptions = {
  sortProperty: string;
  sortDirection?: SortDirection;
  limit?: number;
  cursor?: string;
  /** only returns a cursor if there are additional results available at the time of the query  */
  strictCursor?: boolean;
};

export enum SortDirection {
  Descending = -1,
  Ascending = 1
}

export type KeyValues = { [key:string]: string | number | boolean };

export type EqualFilter = string | number | boolean;

export type OneOfFilter = EqualFilter[];

export type RangeValue = string | number;

/**
 * "greater than" or "greater than or equal to" range condition. `gt` and `gte` are mutually exclusive.
 */
export type GT = ({ gt: RangeValue } & { gte?: never }) | ({ gt?: never } & { gte: RangeValue });

/**
 * "less than" or "less than or equal to" range condition. `lt`, `lte` are mutually exclusive.
 */
export type LT = ({ lt: RangeValue } & { lte?: never }) | ({ lt?: never } & { lte: RangeValue });

/**
 * Ranger filter. 1 condition is required.
 */
export type RangeFilter = (GT | LT) & Partial<GT> & Partial<LT>;

export type FilterValue = EqualFilter | OneOfFilter | RangeFilter;

export type Filter = {
  [property: string]: FilterValue;
};

export type RangeCriterion = {
  /**
   * Inclusive starting date-time.
   */
  from?: string;

  /**
   * Inclusive end date-time.
   */
  to?: string;
};

export type PaginatedEntries<T> = {
  entries: T[];
  cursor?: string;
};
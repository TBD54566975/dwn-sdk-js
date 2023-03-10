import type { LevelDatabase } from './create-level.js';
import type { AbstractBatchDelOperation, AbstractBatchOperation, AbstractIteratorOptions } from 'abstract-level';

import { abortOr } from '../utils/abort.js';
import { createLevelDatabase } from './create-level.js';
import { flatten } from '../utils/object.js';

export type Entry = {
  _id: string,
  [property: string]: unknown
};

export type EqualFilter = string | number | boolean;

export type OneOfFilter = EqualFilter[];

type GT = ({ gt: string } & { gte?: never }) | ({ gt?: never } & { gte: string });
type LT = ({ lt: string } & { lte?: never }) | ({ lt?: never } & { lte: string });
export type RangeFilter = (GT | LT) & Partial<GT> & Partial<LT>;

export type Filter = {
  [property: string]: EqualFilter | OneOfFilter | RangeFilter
};

export interface IndexLevelOptions {
  signal?: AbortSignal;
}

export class IndexLevel {
  config: IndexLevelConfig;

  db: LevelDatabase<string, string>;

  constructor(config?: IndexLevelConfig) {
    this.config = {
      createLevelDatabase,
      ...config
    };
  }

  async open(): Promise<void> {
    await this.createLevelDatabase();

    return this.db.open();
  }

  async close(): Promise<void> {
    if (!this.db) {
      return;
    }

    return this.db.close();
  }

  async put(entry: Entry, options?: IndexLevelOptions): Promise<void> {
    options?.signal?.throwIfAborted();

    await abortOr(options?.signal, this.createLevelDatabase());

    entry = flatten(entry) as Entry;
    const { _id } = entry;

    const ops: AbstractBatchOperation<LevelDatabase<string, string>, string, string>[] = [ ];
    const prefixes: string[] = [ ];
    for (const property in entry) {
      if (property === '_id') {
        continue;
      }

      const value = entry[property];

      const prefix = this.join(property, this.encodeValue(value));
      ops.push({ type: 'put', key: this.join(prefix, _id), value: _id });
      prefixes.push(prefix);
    }
    ops.push({ type: 'put', key: `__${_id}__prefixes`, value: JSON.stringify(prefixes) });

    await abortOr(options?.signal, this.db.batch(ops));
  }

  async query(filter: Filter, options?: IndexLevelOptions): Promise<Array<string>> {
    options?.signal?.throwIfAborted();

    await abortOr(options?.signal, this.createLevelDatabase());

    const requiredProperties = new Set<string>();
    const missingPropertiesForID: { [id: string]: Set<string> } = { };
    const promises: Promise<Matches>[] = [ ];
    const matchedIDs: string[] = [ ];

    async function checkMatches(property: string, promise: Promise<Matches>): Promise<void> {
      promises.push(promise);

      for (const [ _, id ] of await promise) {
        missingPropertiesForID[id] ??= new Set<string>([ ...requiredProperties ]);
        missingPropertiesForID[id].delete(property);
        if (missingPropertiesForID[id].size === 0) {
          matchedIDs.push(id);
        }
      }
    }

    for (const propertyName in filter) {
      const propertyFilter = filter[propertyName];

      if (typeof propertyFilter === 'object' && propertyFilter !== null) {
        if (Array.isArray(propertyFilter)) {
          for (const propertyValue of new Set(propertyFilter)) {
            checkMatches(propertyName, this.findExactMatches(propertyName, propertyValue, options));
          }
        } else {
          checkMatches(propertyName, this.findRangeMatches(propertyName, propertyFilter, options));
        }
      } else {
        checkMatches(propertyName, this.findExactMatches(propertyName, propertyFilter, options));
      }

      requiredProperties.add(propertyName);
    }

    await Promise.all(promises);

    return matchedIDs;
  }

  async delete(id: string, options?: IndexLevelOptions): Promise<void> {
    options?.signal?.throwIfAborted();

    await abortOr(options?.signal, this.createLevelDatabase());

    const prefixes = await abortOr(options?.signal, this.db.get(`__${id}__prefixes`));
    if (!prefixes) {
      return;
    }

    const ops: AbstractBatchDelOperation<LevelDatabase<string, string>, string>[] = [ ];
    for (const prefix of JSON.parse(prefixes)) {
      ops.push({ type: 'del', key: this.join(prefix, id) });
    }
    ops.push({ type: 'del', key: `__${id}__prefixes` });

    await abortOr(options?.signal, this.db.batch(ops));
  }

  clear(): Promise<void> {
    return this.db.clear();
  }

  private async findExactMatches(propertyName: string, propertyValue: unknown, options?: IndexLevelOptions): Promise<Matches> {
    const propertyKey = this.join(propertyName, this.encodeValue(propertyValue));

    const iteratorOptions: AbstractIteratorOptions<string, string> = {
      gt: propertyKey
    };

    return this.findMatches(propertyKey, iteratorOptions, options);
  }

  private async findRangeMatches(propertyName: string, range: RangeFilter, options?: IndexLevelOptions): Promise<Matches> {
    const propertyKey = this.join(propertyName);

    const iteratorOptions: AbstractIteratorOptions<string, string> = { };
    for (const comparator in range) {
      iteratorOptions[comparator] = this.join(propertyName, this.encodeValue(range[comparator]));
    }

    const matches = await this.findMatches(propertyKey, iteratorOptions, options);

    if ('lte' in range) {
      // When using `lte` we must also query for an exact match due to how we're encoding values.
      // For example, `{ lte: 'foo' }` would not match `'foo\x02bar'`.
      for (const [ key, value ] of await this.findExactMatches(propertyName, range.lte, options)) {
        matches.set(key, value);
      }
    }

    return matches;
  }

  private async findMatches(
    propertyName: string,
    iteratorOptions: AbstractIteratorOptions<string, string>,
    options?: IndexLevelOptions
  ): Promise<Matches> {
    // Since we will stop iterating if we encounter entries that do not start with the `propertyName`, we need to always start from the upper bound.
    // For example, `{ lte: 'b' }` would immediately stop if the data was `[ 'a', 'ab', 'b' ]` since `'a'` does not start with `'b'`.
    if (('lt' in iteratorOptions || 'lte' in iteratorOptions) && !('gt' in iteratorOptions || 'gte' in iteratorOptions)) {
      iteratorOptions.reverse = true;
    }

    const matches = new Map<string, string>;
    for await (const [ key, value ] of this.db.iterator(iteratorOptions)) {
      options?.signal?.throwIfAborted();

      if (!key.startsWith(propertyName)) {
        break;
      }

      matches.set(key, value);
    }
    return matches;
  }

  private encodeValue(value: unknown): string {
    if (typeof value === 'string') {
      // We can't just `JSON.stringify` as that'll affect the sort order of strings.
      // For example, `'\x00'` becomes `'\\u0000'`.
      return `"${value}"`;
    }

    return String(value);
  }

  private join(...values: unknown[]): string {
    return values.join(`\x00`);
  }

  private async createLevelDatabase(): Promise<void> {
    this.db ??= await this.config.createLevelDatabase<string, string>(this.config.location, { keyEncoding: 'utf8', valueEncoding: 'utf8' });
  }
}

type IndexLevelConfig = {
  location: string,
  createLevelDatabase?: typeof createLevelDatabase,
};

type Matches = Map<string, string>;
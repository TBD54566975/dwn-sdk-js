import type { Filter, RangeFilter } from '../types/message-types.js';
import type { LevelWrapperBatchOperation, LevelWrapperIteratorOptions } from './level-wrapper.js';

import { flatten } from '../utils/object.js';
import { createLevelDatabase, LevelWrapper } from './level-wrapper.js';

export interface IndexLevelOptions {
  signal?: AbortSignal;
}

/**
 * A LevelDB implementation for indexing the messages stored in the DWN.
 */
export class IndexLevel {
  config: IndexLevelConfig;

  db: LevelWrapper<string>;

  constructor(config: IndexLevelConfig) {
    this.config = {
      createLevelDatabase,
      ...config
    };

    this.db = new LevelWrapper<string>({ ...this.config, valueEncoding: 'utf8' });
  }

  async open(): Promise<void> {
    return this.db.open();
  }

  async close(): Promise<void> {
    return this.db.close();
  }

  /**
   * Adds indexes for a specific data/object/content.
   * @param id ID of the data/object/content being indexed.
   */
  async put(
    id: string,
    indexes: { [property: string]: unknown },
    options?: IndexLevelOptions
  ): Promise<void> {

    indexes = flatten(indexes);

    const ops: LevelWrapperBatchOperation<string>[] = [ ];
    const prefixes: string[] = [ ];

    // create an index entry for each property in the `indexes`
    for (const property in indexes) {
      const value = indexes[property];

      // example keys (\u0000 is just shown for illustration purpose because it is the delimiter used to join the string segments below):
      // 'interface\u0000"Records"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // 'method\u0000"Write"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // 'schema\u0000"http://ud4kyzon6ugxn64boz7v"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // 'dataCid\u0000"bafkreic3ie3cxsblp46vn3ofumdnwiqqk4d5ah7uqgpcn6xps4skfvagze"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      // 'dateCreated\u0000"2023-05-25T18:23:29.425008Z"\u0000bafyreigs3em7lrclhntzhgvkrf75j2muk6e7ypq3lrw3ffgcpyazyw6pry'
      const prefix = this.join(property, this.encodeValue(value));
      const key = this.join(prefix, id);
      ops.push({ type: 'put', key, value: id });
      prefixes.push(prefix);
    }

    // create a reverse lookup entry for data ID -> all its indexes
    // this is for indexes deletion (`delete`): so that given the data ID, we are able to delete all its indexes
    ops.push({ type: 'put', key: `__${id}__prefixes`, value: JSON.stringify(prefixes) });

    return this.db.batch(ops, options);
  }

  async query(filter: Filter, options?: IndexLevelOptions): Promise<Array<string>> {
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
    const prefixes = await this.db.get(`__${id}__prefixes`, options);
    if (!prefixes) {
      return;
    }

    const ops: LevelWrapperBatchOperation<string>[] = [ ];
    for (const prefix of JSON.parse(prefixes)) {
      ops.push({ type: 'del', key: this.join(prefix, id) });
    }
    ops.push({ type: 'del', key: `__${id}__prefixes` });

    return this.db.batch(ops, options);
  }

  async clear(): Promise<void> {
    return this.db.clear();
  }

  private async findExactMatches(propertyName: string, propertyValue: unknown, options?: IndexLevelOptions): Promise<Matches> {
    const indexKeyPrefix = this.join(propertyName, this.encodeValue(propertyValue));

    const iteratorOptions: LevelWrapperIteratorOptions<string> = {
      gt: indexKeyPrefix
    };

    return this.findMatches(indexKeyPrefix, iteratorOptions, options);
  }

  private async findRangeMatches(propertyName: string, range: RangeFilter, options?: IndexLevelOptions): Promise<Matches> {
    const iteratorOptions: LevelWrapperIteratorOptions<string> = { };
    for (const comparator in range) {
      iteratorOptions[comparator] = this.join(propertyName, this.encodeValue(range[comparator]));
    }

    const matches = await this.findMatches(propertyName, iteratorOptions, options);

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
    indexKeyPrefix: string,
    iteratorOptions: LevelWrapperIteratorOptions<string>,
    options?: IndexLevelOptions
  ): Promise<Matches> {
    // Since we will stop iterating if we encounter entries that do not start with the `indexKeyPrefix`, we need to always start from the upper bound.
    // For example, `{ lte: 'b' }` would immediately stop if the data was `[ 'a', 'ab', 'b' ]` since `'a'` does not start with `'b'`.
    if (('lt' in iteratorOptions || 'lte' in iteratorOptions) && !('gt' in iteratorOptions || 'gte' in iteratorOptions)) {
      iteratorOptions.reverse = true;
    }

    const matches = new Map<string, string>;
    for await (const [ key, value ] of this.db.iterator(iteratorOptions, options)) {
      if (!key.startsWith(indexKeyPrefix)) {
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

  /**
   * Joins the given values using the `\x00` (\u0000) character.
   */
  private join(...values: unknown[]): string {
    return values.join(`\x00`);
  }

  async dump(): Promise<void> {
    console.group('db');
    await this.db['dump']?.();
    console.groupEnd();
  }
}

type IndexLevelConfig = {
  location: string,
  createLevelDatabase?: typeof createLevelDatabase,
};

type Matches = Map<string, string>;
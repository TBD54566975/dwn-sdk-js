import type { AbstractDatabaseOptions, AbstractLevel } from 'abstract-level';

import { Level } from 'level';

export type LevelDatabase<K, V> = AbstractLevel<string | Buffer | Uint8Array, K, V>;

export type LevelDatabaseOptions<K, V> = AbstractDatabaseOptions<K, V>;

export function createLevelDatabase<K, V>(location: string, options?: LevelDatabaseOptions<K, V>): LevelDatabase<K, V> {
  return new Level(location, options);
}

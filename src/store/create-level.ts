import type { AbstractDatabaseOptions, AbstractLevel } from 'abstract-level';

export type LevelDatabase<K, V> = AbstractLevel<string | Buffer | Uint8Array, K, V>;

export type LevelDatabaseOptions<K, V> = AbstractDatabaseOptions<K, V>;

export async function createLevelDatabase<K, V>(location: string, options?: LevelDatabaseOptions<K, V>): Promise<LevelDatabase<K, V>> {
  // Only import `'level'` when it's actually necessary (i.e. only when the default `createLevelDatabase` is used).
  // Overriding `createLevelDatabase` will prevent this from happening.
  const { Level } = await import('level');
  return new Level(location, options);
}

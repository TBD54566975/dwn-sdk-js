import type { Filter } from '../types/query-types.js';
import type { ULIDFactory } from 'ulidx';
import type { EventLog, GetEventsOptions } from '../types/event-log.js';

import { createLevelDatabase } from '../store/level-wrapper.js';
import { IndexLevel } from '../store/index-level.js';
import { monotonicFactory } from 'ulidx';
import { SortDirection } from '../types/query-types.js';

type EventLogLevelConfig = {
 /**
   * must be a directory path (relative or absolute) where
   *  LevelDB will store its files, or in browsers, the name of the
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase IDBDatabase} to be opened.
  */
  location?: string,
  createLevelDatabase?: typeof createLevelDatabase,
};

export class EventLogLevel implements EventLog {
  ulidFactory: ULIDFactory;
  index: IndexLevel;

  constructor(config?: EventLogLevelConfig) {
    this.index = new IndexLevel({
      location: 'EVENTLOG',
      createLevelDatabase,
      ...config,
    });

    this.ulidFactory = monotonicFactory();
  }

  async open(): Promise<void> {
    return this.index.open();
  }

  async close(): Promise<void> {
    return this.index.close();
  }

  async clear(): Promise<void> {
    return this.index.clear();
  }

  async append(tenant: string, messageCid: string, indexes: { [key:string]: unknown }): Promise<void> {
    const watermark = this.ulidFactory();
    await this.index.put(tenant, messageCid, { ...indexes, watermark });
  }

  async queryEvents(tenant: string, filters: Filter[], watermark?: string): Promise<string[]> {
    return await this.index.query(tenant, filters, { sortProperty: 'watermark', cursor: watermark });
  }

  async getEvents(tenant: string, options?: GetEventsOptions): Promise<string[]> {
    return await this.index.query(tenant, [], { sortProperty: 'watermark', sortDirection: SortDirection.Ascending, cursor: options?.gt });
  }

  async deleteEventsByCid(tenant: string, messageCids: Array<string>): Promise<void> {
    const indexDeletePromises: Promise<void>[] = [];
    for (const messageCid of messageCids) {
      indexDeletePromises.push(this.index.delete(tenant, messageCid));
    }

    await Promise.all(indexDeletePromises);
  }
}
import type { EventLog } from '../types/event-log.js';
import type { EventStream } from '../types/subscriptions.js';
import type { ULIDFactory } from 'ulidx';
import type { Filter, KeyValues, PaginationCursor } from '../types/query-types.js';

import { createLevelDatabase } from '../store/level-wrapper.js';
import { IndexLevel } from '../store/index-level.js';
import { monotonicFactory } from 'ulidx';

type EventLogLevelConfig = {
 /**
   * must be a directory path (relative or absolute) where
   *  LevelDB will store its files, or in browsers, the name of the
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase IDBDatabase} to be opened.
  */
  location?: string,
  createLevelDatabase?: typeof createLevelDatabase,
  eventStream?: EventStream,
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

  async append(tenant: string, messageCid: string, indexes: KeyValues): Promise<void> {
    const watermark = this.ulidFactory();
    await this.index.put(tenant, messageCid, { ...indexes, watermark });
  }

  async queryEvents(tenant: string, filters: Filter[], cursor?: PaginationCursor): Promise<{ events: string[], cursor?: PaginationCursor }> {
    const results = await this.index.query(tenant, filters, { sortProperty: 'watermark', cursor });
    return {
      events : results.map(({ messageCid }) => messageCid),
      cursor : IndexLevel.createCursorFromLastArrayItem(results, 'watermark'),
    };
  }

  async getEvents(tenant: string, cursor?: PaginationCursor): Promise<{ events: string[], cursor?: PaginationCursor }> {
    return this.queryEvents(tenant, [], cursor);
  }

  async deleteEventsByCid(tenant: string, messageCids: Array<string>): Promise<void> {
    const indexDeletePromises: Promise<void>[] = [];
    for (const messageCid of messageCids) {
      indexDeletePromises.push(this.index.delete(tenant, messageCid));
    }

    await Promise.all(indexDeletePromises);
  }
}
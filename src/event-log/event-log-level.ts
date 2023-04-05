import type { ULID } from 'ulid';
import type { Event, EventLog, GetEventsOptions } from './event-log.js';

import { monotonicFactory } from 'ulid';
import { createLevelDatabase, LevelWrapper } from '../store/level-wrapper.js';


type EventLogLevelConfig = {
 /**
   * must be a directory path (relative or absolute) where
   *  LevelDB will store its files, or in browsers, the name of the
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase IDBDatabase} to be opened.
  */
  location: string,
  createLevelDatabase?: typeof createLevelDatabase,
};

export class EventLogLevel implements EventLog {
  config: EventLogLevelConfig;
  db: LevelWrapper<string>;
  ulid: ULID;

  constructor(config?: EventLogLevelConfig) {
    this.config = {
      location: 'EVENTLOG',
      createLevelDatabase,
      ...config,
    };

    this.db = new LevelWrapper<string>({ ...this.config, valueEncoding: 'utf8' });
    this.ulid = monotonicFactory();
  }

  async open(): Promise<void> {
    return this.db.open();
  }

  async close(): Promise<void> {
    return this.db.close();
  }

  async clear(): Promise<void> {
    return this.db.clear();
  }

  async append(tenant: string, messageCid: string): Promise<string> {
    const tenantEventLog = await this.db.partition(tenant);

    const watermark = this.ulid();
    await tenantEventLog.put(watermark, messageCid);

    return watermark;
  }

  async getEvents(tenant: string, options?: GetEventsOptions): Promise<Event[]> {
    const tenantEventLog = await this.db.partition(tenant);
    const events: Array<Event> = [];

    for await (const [key, value] of tenantEventLog.iterator(options)) {
      const event = { watermark: key, messageCid: value };
      events.push(event);
    }

    return events;
  }

  async deleteEventsByCid(tenant: string, cids: Array<string>): Promise<number> {
    if (cids.length === 0) {
      return 0;
    }

    const cidSet = new Set(cids);
    const tenantEventLog = await this.db.partition(tenant);
    const ops = [];

    let numEventsDeleted = 0;

    for await (const [key, value] of tenantEventLog.iterator()) {
      if (cidSet.has(value)) {
        ops.push({ type: 'del', key });
        numEventsDeleted += 1;
      }
    }

    await tenantEventLog.batch(ops);

    return numEventsDeleted;
  }

  async dump(): Promise<void> {
    console.group('db');
    await this.db['dump']?.();
    console.groupEnd();
  }
}
import type { ULID } from 'ulid';
import type { Event, EventLog } from './event-log.js';

import { base32crockford } from '@scure/base';
import { Encoder } from '../utils/encoder.js';
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
    const hashedTenant = this.hashTenant(tenant);
    const tenantEventLog = await this.db.partition(hashedTenant);

    const watermark = this.ulid();
    await tenantEventLog.put(watermark, messageCid);

    return watermark;
  }
  async getEventsAfter(tenant: string, watermark?: string): Promise<Event[]> {
    const hashedTenant = this.hashTenant(tenant);
    const tenantEventLog = await this.db.partition(hashedTenant);

    const opts = watermark ? { gt: watermark } : {};
    const events: Array<Event> = [];

    for await (const [key, value] of tenantEventLog.iterator(opts)) {
      const event = { watermark: key, messageCid: value };
      events.push(event);
    }

    return events;
  }

  hashTenant(tenant: string): string {
    const tenantBytes = Encoder.stringToBytes(tenant);

    return base32crockford.encode(tenantBytes);
  }
}
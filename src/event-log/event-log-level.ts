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
  level: LevelWrapper<string>;
  ulid: ULID;

  constructor(config: EventLogLevelConfig = { location: 'EVENTLOG' }) {
    this.config = {
      createLevelDatabase,
      ...config,
    };

    this.level = new LevelWrapper<string>({ ...this.config, valueEncoding: 'utf8' });
    this.ulid = monotonicFactory();
  }

  async open(): Promise<void> {
    // `db.open()` is automatically called by the database constructor.  We're calling it explicitly
    // in order to explicitly catch an error that would otherwise not surface until another method
    // like `db.get()` is called.  Once `db.open()` has then been called, any read & write
    // operations will again be queued internally until opening has finished.
    return this.level.open();
  }

  close(): Promise<void> {
    return this.level.close();
  }

  clear(): Promise<void> {
    return this.level.clear();
  }

  async append(tenant: string, messageCid: string): Promise<string> {
    const hashedTenant = this.hashTenant(tenant);
    const tenantEventLog = await this.level.partition(hashedTenant);

    const watermark = this.ulid();
    await tenantEventLog.put(watermark, messageCid);

    return watermark;
  }
  async getEventsAfter(tenant: string, watermark?: string | undefined): Promise<Event[]> {
    const hashedTenant = this.hashTenant(tenant);
    const tenantEventLog = await this.level.partition(hashedTenant);

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
import type { LevelWrapperBatchOperation } from '../store/level-wrapper.js';
import type { ULIDFactory } from 'ulidx';
import type { Event, EventLog, GetEventsOptions } from '../types/event-log.js';

import { monotonicFactory } from 'ulidx';
import { createLevelDatabase, LevelWrapper } from '../store/level-wrapper.js';

type EventLogLevelConfig = {
 /**
   * must be a directory path (relative or absolute) where
   *  LevelDB will store its files, or in browsers, the name of the
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase IDBDatabase} to be opened.
  */
  location?: string,
  createLevelDatabase?: typeof createLevelDatabase,
};

const WATERMARKS_SUBLEVEL_NAME = 'watermarks';
const CIDS_SUBLEVEL_NAME = 'cids';

export class EventLogLevel implements EventLog {
  config: EventLogLevelConfig;
  db: LevelWrapper<string>;
  ulidFactory: ULIDFactory;

  constructor(config?: EventLogLevelConfig) {
    this.config = {
      location: 'EVENTLOG',
      createLevelDatabase,
      ...config,
    };

    this.db = new LevelWrapper<string>({
      location            : this.config.location!,
      createLevelDatabase : this.config.createLevelDatabase,
      valueEncoding       : 'utf8',
    });
    this.ulidFactory = monotonicFactory();
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
    const watermarkLog = await tenantEventLog.partition(WATERMARKS_SUBLEVEL_NAME);
    const cidLog = await tenantEventLog.partition(CIDS_SUBLEVEL_NAME);

    const watermark = this.ulidFactory();

    await watermarkLog.put(watermark, messageCid);
    await cidLog.put(messageCid, watermark);

    return watermark;
  }

  async getEvents(tenant: string, options?: GetEventsOptions): Promise<Event[]> {
    const tenantEventLog = await this.db.partition(tenant);
    const watermarkLog = await tenantEventLog.partition(WATERMARKS_SUBLEVEL_NAME);
    const events: Array<Event> = [];

    for await (const [key, value] of watermarkLog.iterator(options)) {
      const event = { watermark: key, messageCid: value };
      events.push(event);
    }

    return events;
  }

  async deleteEventsByCid(tenant: string, cids: Array<string>): Promise<number> {
    if (cids.length === 0) {
      return 0;
    }

    const tenantEventLog = await this.db.partition(tenant);
    const cidLog = await tenantEventLog.partition(CIDS_SUBLEVEL_NAME);

    let ops: LevelWrapperBatchOperation<string>[] = [];
    const promises: Array<Promise<string | undefined>> = [];

    for (const cid of cids) {
      ops.push({ type: 'del', key: cid });

      const promise = cidLog.get(cid).catch(e => e);
      promises.push(promise);
    }

    await cidLog.batch(ops);

    ops = [];
    let numEventsDeleted = 0;

    const watermarks: Array<string | undefined> = await Promise.all(promises);
    for (const watermark of watermarks) {
      if (watermark) {
        ops.push({ type: 'del', key: watermark });
        numEventsDeleted += 1;
      }
    }

    const watermarkLog = await tenantEventLog.partition('watermarks');
    await watermarkLog.batch(ops);

    return numEventsDeleted;
  }
}
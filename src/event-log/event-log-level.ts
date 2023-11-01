import type { Filter } from '../types/message-types.js';
import type { LevelWrapperBatchOperation } from '../store/level-wrapper.js';
import type { ULIDFactory } from 'ulidx';
import type { Event, EventLog, GetEventsOptions } from '../types/event-log.js';

import { IndexLevel } from '../store/index-level.js';
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
  db: LevelWrapper<string>;
  ulidFactory: ULIDFactory;
  index: IndexLevel<Event>;

  constructor(config?: EventLogLevelConfig) {
    const eventLogConfig = {
      location: 'EVENTLOG',
      createLevelDatabase,
      ...config,
    };

    this.db = new LevelWrapper<string>({ ...eventLogConfig, valueEncoding: 'utf8' });
    this.index = new IndexLevel(this.db);
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

  /**
   * Appends messageCids to the EventLog in the order they are appended using a ulid watermark.
   * optionally add indexable properties to allow for querying filtered events.
   *
   * @param tenant
   * @param messageCid the messageCid of the message that is being appended to the log.
   * @param indexes property and value indexes to use for querying potential events.
   * @returns the ulid watermark generated during this operation.
   */
  async append(tenant: string, messageCid: string, indexes: { [key:string]: unknown }): Promise<string> {
    const tenantEventLog = await this.db.partition(tenant);
    const watermarkLog = await tenantEventLog.partition(WATERMARKS_SUBLEVEL_NAME);
    const cidLog = await tenantEventLog.partition(CIDS_SUBLEVEL_NAME);
    const watermark = this.ulidFactory();
    await watermarkLog.put(watermark, messageCid);
    await cidLog.put(messageCid, watermark);
    await this.index.put(tenant, watermark, { messageCid, watermark }, indexes, { watermark });
    return watermark;
  }

  /**
   * Queries Events for a given tenant using the filters provided.
   * Each filter has it's own watermark, this is to prevent returning already fetched data
   * if adding a new filter to a subsequent request.
   *
   * @param tenant
   * @param filters an array of filters that designates which event properties are being queried.
   * @returns an array of matching Events without duplicate entries between the filters.
   */
  async queryEvents(tenant: string, filters: Filter[], watermark?: string): Promise<Event[]> {
    return await this.index.query(tenant, filters, { sortProperty: 'watermark', cursor: watermark });
  }

  /**
   * Gets Events for a given tenant. An optional watermark is specified to get events beyond a certain point in time.
   *
   * @param tenant
   * @param options options with that take an optional watermark.
   * @returns an array of Events for the given tenant, if a watermark is provided only Events appended after tha watermark will be returned.
   */
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

  /**
   * Deletes Events associated with a given cid. Deletes any indexes that were created along with it as well.
   * @param tenant
   * @param messageCids an array of messageCids to delete.
   * @returns the number of events deleted.
   */
  async deleteEventsByCid(tenant: string, messageCids: Array<string>): Promise<number> {
    if (messageCids.length === 0) {
      return 0;
    }

    const tenantEventLog = await this.db.partition(tenant);
    const cidLog = await tenantEventLog.partition(CIDS_SUBLEVEL_NAME);
    const watermarkLog = await tenantEventLog.partition(WATERMARKS_SUBLEVEL_NAME);

    const ops: LevelWrapperBatchOperation<string>[] = [];
    const cidOps: LevelWrapperBatchOperation<string>[] = [];

    let numEventsDeleted = 0;
    const indexDeletePromises: Promise<void>[] = [];
    for (const messageCid of messageCids) {
      const watermark = await cidLog.get(messageCid);
      if (watermark === undefined) {
        continue;
      }
      ops.push({ type: 'del', key: watermark });
      cidOps.push({ type: 'del', key: messageCid });
      indexDeletePromises.push(this.index.delete(tenant, watermark));
      numEventsDeleted += 1;
    }

    await watermarkLog.batch(ops);
    await cidLog.batch(cidOps);
    await Promise.all(indexDeletePromises);
    return numEventsDeleted;
  }
}
import type { Filter } from '../types/index-types.js';
import type { ULIDFactory } from 'ulidx';
import type { Event, EventLog, GetEventsOptions } from '../types/event-log.js';
import type { LevelWrapper, LevelWrapperBatchOperation } from '../store/level-wrapper.js';

import { createLevelDatabase } from '../store/level-wrapper.js';
import { IndexLevel } from '../store/index-level.js';
import { monotonicFactory } from 'ulidx';
import { SortDirection } from '../types/index-types.js';

type EventLogLevelConfig = {
 /**
   * must be a directory path (relative or absolute) where
   *  LevelDB will store its files, or in browsers, the name of the
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase IDBDatabase} to be opened.
  */
  location?: string,
  createLevelDatabase?: typeof createLevelDatabase,
};

const CIDS_SUBLEVEL_NAME = 'cids';

export class EventLogLevel implements EventLog {
  ulidFactory: ULIDFactory;
  index: IndexLevel<Event>;

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

  /**
   * Appends Events to the EventLog in the order they are appended using a ulid watermark.
   * The indexes are used to query the event-log for specific events.
   *
   * @param tenant
   * @param messageCid the messageCid of the message that is being appended to the log.
   * @param indexes property and value indexes to use for querying potential events.
   * @returns the ulid watermark generated during this operation.
   */
  async append(tenant: string, messageCid: string, indexes: { [key:string]: unknown }): Promise<string> {
    const watermark = this.ulidFactory();
    // A reverse lookup in order to delete by messageCid
    // We are using the watermark as the key for this index.
    // When deleting by messageCid we need to look up the watermark.
    const cidLogIndex = await this.messageCidPartition(tenant);
    await cidLogIndex.put(messageCid, watermark);

    const event:Event = { messageCid, watermark };
    await this.index.put(tenant, watermark, event, { ...indexes, watermark });
    return watermark;
  }

  /**
   * Queries Events for a given tenant using the filters provided.
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
    return await this.index.query(tenant, [], { sortProperty: 'watermark', sortDirection: SortDirection.Ascending, cursor: options?.gt });
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

    const cidLog = await this.messageCidPartition(tenant);
    const cidOps: LevelWrapperBatchOperation<string>[] = [];
    const indexDeletePromises: Promise<void>[] = [];

    let numEventsDeleted = 0;
    for (const messageCid of messageCids) {
      const watermark = await cidLog.get(messageCid);
      if (watermark === undefined) {
        continue;
      }
      cidOps.push({ type: 'del', key: messageCid });
      indexDeletePromises.push(this.index.delete(tenant, watermark));
      numEventsDeleted += 1;
    }

    await cidLog.batch(cidOps);
    await Promise.all(indexDeletePromises);
    return numEventsDeleted;
  }

  /**
   * Gets the LevelDB Sublevel for the messageCid reverse lookup.
   */
  private async messageCidPartition(tenant: string): Promise<LevelWrapper<string>> {
    const tenantIndex = await this.index.db.partition(tenant);
    return tenantIndex.partition(CIDS_SUBLEVEL_NAME);
  }
}
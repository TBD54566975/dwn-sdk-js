export type Event = {
  watermark: string,
  messageCid: string
};


export type GetEventsOptions = {
  gt: string
};

export interface EventLog {
 /**
  * opens a connection to the underlying store
  */
  open(): Promise<void>;

  /**
   * closes the connection to the underlying store
   */
  close(): Promise<void>;

  /**
   * adds an event to a tenant's event log
   * @param tenant - the tenant's DID
   * @param messageCid - the CID of the message
   * @returns {Promise<string>} watermark
   */
  append(tenant: string, messageCid: string): Promise<string>

  /**
   * retrieves all of a tenant's events that occurred after the watermark provided.
   * If no watermark is provided, all events for a given tenant will be returned.
   *
   * @param tenant
   * @param watermark
   */
  getEvents(tenant: string, options?: GetEventsOptions): Promise<Array<Event>>

  /**
   * deletes any events that have any of the cids provided
   * @param tenant
   * @param cids
   * @returns {Promise<number>} the number of events deleted
   */
  deleteEventsByCid(tenant: string, cids: Array<string>): Promise<number>
}
/**
 * An managed resumable task model.
 */
export type ManagedResumableTask = {
  /** Globally unique ID. Used to extend or delete the task. */
  id: string;
  /** Task specific data. This is deliberately of type `any` because this store should not have to be ware of its type. */
  task: any;
  /** Task timeout in Epoch Time. */
  timeout: number;
  /** Number of retries */
  retryCount: number;
};

/**
 * Interface for interacting with the resumable task store.
 *
 * Implementer's Note.
 * The store implementation used in a horizontally scalable deployment, such as in a Kubernetes cluster,
 * must account for concurrent access by multiple `ResumableTaskStore` instances.
 * It would be undesirable to have many kubernetes pods all trying to handle the same resumable task.
 * A minimal viable implementation can use a per tenant exclusive lock on the store when `grab()` and  method is called.
 * This would prevent issues that occur from concurrent modification to the same task to the store,
 * but negatively impacts the throughput performance of the DWN.
 * Requirements for a more performant implementation that allows distributed processing of resumable tasks across multiple clients:
 * 1. The implementation probably requires both:
 *   a. a persistent store for storing the data of each resumable task; and
 *   b. an message streaming queue/service for distributing the each task exclusively to one of multiple handling clients.
 * 2. The `grab()` and/or `open()` implementation will need to copy the timed-out tasks from persistent store into the message queue/service
 *    for distributed processing by multiple clients when there is no resumable tasks to grab in the message queue.
 *    During the move, the persistent store should be locked to prevent multiple copies of the same tasks from being copied.
 * 3. Both Google's pub-sub and Amazon's SQS require an Ack ID / Receipt Handle to acknowledge the message,
 *    The value of Ack ID / Receipt Handle is not known until the message is received,
 *    therefore the implementer will likely need to have an in-memory mapping of task ID -> Ack ID / Receipt Handle
 *    so that `delete()` can be called with task ID.
 */
export interface ResumableTaskStore {
  /**
   * Opens a connection to the underlying store and initializes it.
   */
  open(): Promise<void>;

  /**
   * Closes the connection to the underlying store.
   */
  close(): Promise<void>;

  /**
   * Registers a new resumable task that is currently in-flight/under processing to the store.
   * If the task is timed out, a client will be able to grab it through the `grab()` method and resume the task.
   * @param task Task specific data.  This is deliberately of type `any` because this store should not have to be ware of its type.
   * @param timeoutInSeconds Timeout in seconds from the current time.
   * @returns A `ManagedResumableTask` object that can be used to extend or delete the task.
   * @throws {Error} with `code` set to `ResumableTaskAlreadyExists` if the same task is already registered.
   */
  register(task: any, timeoutInSeconds: number): Promise<ManagedResumableTask>;

  /**
   * Grabs a number of unhandled tasks from the store. Unhandled tasks are tasks that are not currently in-flight/under processing.
   * NOTE: The implementation must make sure that once the tasks are grabbed by a client,
   * they are considered in-flight/under processing and cannot be grabbed by another client until they are timed out.
   * @param count Desired number of tasks to grab.
   * @returns A list of tasks exclusive for the caller to handle; or empty array if there is no tasks, or if all tasks are already grabbed by others.
   */
  grab(count: number): Promise<ManagedResumableTask[]>;

  /**
   * Reads the task associated with the task ID provided regardless of whether it is in-flight/under processing or not.
   * This is mainly introduced for testing purposes: ie. to check the status of a task for easy test verification.
   * @param taskId ID of the task to read.
   */
  read(taskId: string): Promise<ManagedResumableTask | undefined>;

  /**
   * Extends the timeout of the task associated with the task ID provided.
   * No-op if the task is not found, as this implies that the task has already been completed.
   * This allows the client that is executing the task to continue working on it before the task is considered timed out.
   * @param taskId ID of the task to extend the timeout for.
   * @param timeoutInSeconds Timeout in seconds from the current time.
   */
  extend(taskId: string, timeoutInSeconds: number): Promise<void>;

  /**
   * Deletes the task associated with the task ID provided.
   * No-op if the task is not found, as this implies that the task has already been completed.
   * Called when the task has been successfully completed.
   */
  delete(taskId: string): Promise<void>;

  /**
   * Clears the entire store. Mainly used for cleaning up in test environment.
   */
  clear(): Promise<void>;
}
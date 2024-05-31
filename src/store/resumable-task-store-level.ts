import type { ManagedResumableTask, ResumableTaskStore } from '../types/resumable-task-store.js';

import { Cid } from '../utils/cid.js';
import { createLevelDatabase, LevelWrapper } from './level-wrapper.js';

type ResumableTaskStoreLevelConfig = {
  location?: string,
  createLevelDatabase?: typeof createLevelDatabase
};

/**
 * A simple single-instance implementation of {@link ResumableTaskStore} that works in both browsers and node.js.
 * Leverages LevelDB under the hood.
 */
export class ResumableTaskStoreLevel implements ResumableTaskStore {
  private static readonly taskTimeoutInSeconds = 60;

  db: LevelWrapper<string>;
  config: ResumableTaskStoreLevelConfig;

  constructor(config: ResumableTaskStoreLevelConfig) {
    this.config = {
      // defaults:
      location: 'RESUMABLE-TASK-STORE',
      createLevelDatabase,
      // user-provided overrides:
      ...config,
    };

    this.db = new LevelWrapper<string>({
      location            : this.config.location!,
      createLevelDatabase : this.config.createLevelDatabase,
      keyEncoding         : 'utf8'
    });
  }

  async open(): Promise<void> {
    await this.db.open();
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  public async register(task: any): Promise<ManagedResumableTask> {
    const taskId = await Cid.computeCid(task);

    const managedResumableTask: ManagedResumableTask = {
      id         : taskId,
      timeout    : Date.now() + (ResumableTaskStoreLevel.taskTimeoutInSeconds * 1000),
      retryCount : 0,
      task,
    };

    await this.db.put(taskId, JSON.stringify(managedResumableTask));

    return managedResumableTask;
  }

  public async grab(count: number): Promise<ManagedResumableTask[] | undefined> {
    const tasks: ManagedResumableTask[] = [];

    // iterate over the tasks to find unhandled tasks to return to the caller
    // NOTE: there is an opportunity here to introduce an additional index where we can query by timed-out tasks,
    // but it requires an additional index thus more complexity
    for await (const [ _, value ] of this.db.iterator()) {
      const task = JSON.parse(value) as ManagedResumableTask;

      // if the task is timed-out, we can give it to the caller to handle
      if (task.timeout >= Date.now()) {
        // update the task metadata first before adding to list of tasks to return
        task.timeout = Date.now() + (ResumableTaskStoreLevel.taskTimeoutInSeconds * 1000);
        task.retryCount++;
        await this.db.put(task.id, JSON.stringify(task));

        tasks.push(task);
      }

      if (tasks.length >= count) {
        break;
      }
    }

    return tasks;
  }

  public async extend(taskId: string, timeoutInSeconds: number): Promise<void> {
    const value = await this.db.get(taskId);

    if (value) {
      const task = JSON.parse(value) as ManagedResumableTask;
      task.timeout = Date.now() + (timeoutInSeconds * 1000);

      await this.db.put(task.id, JSON.stringify(task));
    }
  }

  public async delete(taskId: string): Promise<void> {
    return this.db.delete(taskId);
  }

  /**
   * Deletes everything in the store. Mainly used in tests.
   */
  public async clear(): Promise<void> {
    await this.db.clear();
  }
}

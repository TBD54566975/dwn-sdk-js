import type { StorageController } from '../store/storage-controller.js';
import type { ManagedResumableTask, ResumableTaskStore } from '../types/resumable-task-store.js';

export enum ResumableTaskName {
  RecordsDelete = 'RecordsDelete',
}

export type ResumableTask = {
  name: ResumableTaskName;
  data: any;
};


export class ResumableTaskManager {

  /**
   * The frequency at which the automatic timeout extension is requested for a resumable task.
   */
  public static readonly timeoutExtensionFrequencyInSeconds = 30;

  private resumableTaskBatchSize = 100;
  private resumableTaskHandlers: { [key:string]: (taskData: any) => Promise<void> };

  public constructor(private resumableTaskStore: ResumableTaskStore, storageController: StorageController) {
    // assign resumable task handlers
    this.resumableTaskHandlers = {
      // NOTE: The arrow function is IMPORTANT here, else the `this` context will be lost within the invoked method.
      // e.g. code within performRecordsDelete() won't know `this` refers to the `storageController` instance.
      [ResumableTaskName.RecordsDelete]: async (task): Promise<void> => await storageController.performRecordsDelete(task),
    };
  }

  /**
   * Runs a new resumable task.
   */
  public async run(task: ResumableTask): Promise<void> {
    const timeoutInSeconds = ResumableTaskManager.timeoutExtensionFrequencyInSeconds * 2; // give ample time for extension to take place

    // register the new resumable task before running it so that it can be resumed if it times out for any reason
    const managedResumableTask = await this.resumableTaskStore.register(task, timeoutInSeconds);
    await this.runWithAutomaticTimeoutExtension(managedResumableTask);
  }

  /**
   * Runs a resumable task with automatic timeout extension.
   */
  private async runWithAutomaticTimeoutExtension(managedTask: ManagedResumableTask): Promise<void> {
    const timeoutInSeconds = ResumableTaskManager.timeoutExtensionFrequencyInSeconds * 2; // give ample time for extension to take place

    let timer!: NodeJS.Timer;
    try {
      // start a timer loop to keep extending the timeout of the task until it is completed
      timer = setInterval(() => {
        this.resumableTaskStore.extend(managedTask.id, timeoutInSeconds);
      }, ResumableTaskManager.timeoutExtensionFrequencyInSeconds * 1000);

      const handler = this.resumableTaskHandlers[managedTask.task.name];
      await handler(managedTask.task.data);
      await this.resumableTaskStore.delete(managedTask.id);
    } finally {
      ResumableTaskManager.clearTimeoutExtensionTimer(timer);
    }
  }

  /**
   * Removes the specified timeout extension loop timer.
   * NOTE: created mainly for testing purposes so we can spy on this specific method without needing to filter out other `clearInterval` calls.
   */
  public static clearTimeoutExtensionTimer(timer: NodeJS.Timer): void {
    clearInterval(timer);
  }

  /**
   * Resumes the execution of resumable tasks until all are completed successfully.
   */
  public async resumeTasksAndWaitForCompletion(): Promise<void> {
    while (true) {
      const resumableTasks = await this.resumableTaskStore.grab(this.resumableTaskBatchSize);

      if (resumableTasks === undefined || resumableTasks.length === 0) {
        break;
      }

      // Handle this batch of tasks before grabbing the next batch.
      await this.retryTasksUntilCompletion(resumableTasks);
    }
  }

  /**
   * Repeatedly retry the given tasks until all are completed successfully.
   */
  private async retryTasksUntilCompletion(resumableTasks: ManagedResumableTask[]): Promise<void> {

    let managedTasks = resumableTasks;
    while (managedTasks.length > 0) {
      const managedTasksCopy = managedTasks;
      managedTasks = [];

      const allTaskPromises = managedTasksCopy.map(async (managedTask) => {
        try {
          await this.runWithAutomaticTimeoutExtension(managedTask);
        } catch (error) {
          console.error(`Error while running resumable task: ${managedTask}: ${error}`);
          managedTasks.push(managedTask);
        }
      });

      await Promise.all(allTaskPromises);
    }
  }
}
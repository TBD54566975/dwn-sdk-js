import type { ManagedResumableTask, ResumableTaskStore } from '../types/resumable-task-store.js';

enum ResumableTaskName {
  RecordsDelete = 'RecordsDelete',
}

type ResumableTask = {
  name: string;
  data: any;
};

export class ResumableTaskManager {

  private resumableTaskHandlers: { [key:string]: (task: ResumableTask) => Promise<void> };

  public constructor(private resumableTaskStore: ResumableTaskStore) {
    this.resumableTaskHandlers = {
      [ResumableTaskName.RecordsDelete]: this.handleRecordsDeleteTask,
    };
  }

  /**
   * Resumes the execution of resumable tasks until all are completed successfully.
   */
  public async resumeTasksAndWaitForCompletion(): Promise<void> {
    while (true) {
      const resumableTasks = await this.resumableTaskStore.grab(100);

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
          const handler = this.resumableTaskHandlers[managedTask.task.name];
          await handler(managedTask.task);
          this.resumableTaskStore.delete(managedTask.id);
        } catch {
          managedTasks.push(managedTask);
        }
      });

      await Promise.all(allTaskPromises);
    }
  }

  private async handleRecordsDeleteTask(_task: ResumableTask): Promise<void> {
  }
}
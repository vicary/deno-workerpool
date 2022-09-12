import { JsonValue } from "type-fest";

export interface Task<TPayload = JsonValue> {
  /**
   * Optional task id for easier mutex in database.
   */
  id?: string;

  /**
   * name of the runners executing this task.
   */
  name: string;

  /**
   * The task payload
   */
  payload: TPayload;

  /**
   * How many times this task has been executed, including the current run, the
   * first run and retries.
   */
  executionCount: number;
}

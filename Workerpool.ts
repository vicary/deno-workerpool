import { Class, JsonValue, Promisable, SetOptional } from "type-fest";
import { Runner } from "./Runner.ts";
import { RunnerTask } from "./RunnerTask.ts";
import { Worker, WorkerExecutionError } from "./Worker.ts";

export type WorkerpoolOptions<TPayload = JsonValue, TResult = unknown> = {
  /**
   * Classes which implements the Runner interface.
   */
  runners?: Class<Runner<TPayload, TResult>>[];

  /**
   * Size of the worker pool, A.K.A. poolSize.
   *
   * @default 10
   */
  concurrency?: number;

  /**
   * Retries before treating a task as failed.
   *
   * @default 0,
   */
  maximumRetries?: number;

  /**
   * If specified, workers will be discarded after this many successful or
   * failure tasks.
   *
   * @default Infinity
   */
  maximumTaskPerWorker?: number;

  /**
   * Implementation of task enqueuing.
   *
   * Retries will also call this method with the task object, this function
   * should reset the mutex lock if available.
   */
  enqueue: (task: RunnerTask<TPayload>) => Promisable<void>;

  /**
   * Retrieves the next pending task, this function should acquire mutex lock
   * for the task.
   */
  dequeue: () => Promisable<RunnerTask<TPayload> | undefined>;

  /**
   * Called when a dequeued task is successful, use this function to remove
   * finished tasks (mutex).
   */
  success?: (task: RunnerTask<TPayload>, result: TResult) => Promisable<void>;

  /**
   * Called when a failing task has exceeded maximum retries.
   */
  failure?: (task: RunnerTask<TPayload>, error: Error) => Promisable<void>;
};

export class Workerpool<TPayload = JsonValue, TResult = unknown> {
  #active = false;
  #concurrency = 10;
  #maximumRetries = 0;
  #maximumTaskPerWorker = Infinity;
  #runnerFactories = new Map<string, Class<Runner<TPayload, TResult>>>();
  #workers = new Set<Worker<TPayload, TResult>>();

  constructor(readonly options: WorkerpoolOptions<TPayload, TResult>) {
    options.runners?.forEach((runner) => {
      this.#runnerFactories.set(runner.name, runner);
    });

    if (options.concurrency) {
      this.#concurrency = options.concurrency;
    }

    if (options.maximumRetries) {
      this.#maximumRetries = options.maximumRetries;
    }

    if (options.maximumTaskPerWorker) {
      this.#maximumTaskPerWorker = options.maximumTaskPerWorker;
    }
  }

  get workerCount() {
    return this.#workers.size;
  }

  start() {
    if (this.#active) {
      return;
    }

    this.#active = true;
    this.#dequeue();

    return this;
  }

  pause() {
    this.#active = false;

    // Trigger runner disposal if the queue is already empty.
    this.#dequeue();
  }

  /**
   * @deprecated Use `pause` for elegance.
   */
  stop() {
    return this.pause();
  }

  enqueue({
    executionCount = 0,
    ...task
  }: SetOptional<RunnerTask<TPayload>, "executionCount">) {
    const doEnqueue = async () => {
      await this.options.enqueue({ executionCount, ...task });

      // Don't await for task executions here.
      this.#dequeue();
    };

    doEnqueue();

    return this;
  }

  async #dequeue() {
    if (!this.#active) {
      // Release idle runners
      await Promise.all(
        [...this.#workers]
          .filter((worker) => !worker.busy)
          .map((worker) => worker.dispose())
      );

      return;
    }

    const task = await this.options.dequeue();
    // No tasks available yet, wait for the next dequeue.
    if (!task) {
      return;
    }

    const worker = await this.#getWorker(task.name);
    // No workers available yet, wait for the next dequeue.
    if (!worker) {
      await this.options.enqueue(task);
      return;
    }

    task.executionCount++;
    worker
      .execute(task.payload)
      .then(
        (result) => this.options.success?.(task, result),
        (error) => {
          if (
            error instanceof WorkerExecutionError &&
            error.retryable &&
            task.executionCount < this.#maximumRetries
          ) {
            this.enqueue(task);
          } else {
            this.options.failure?.(task, error);
          }
        }
      )
      .finally(() => {
        if (worker.executionCount >= this.#maximumTaskPerWorker) {
          this.#workers.delete(worker);
        }

        this.#dequeue();
      });

    this.#dequeue();
  }

  async #getWorker(
    name: string
  ): Promise<Worker<TPayload, TResult> | undefined> {
    const idleWorkers = [...this.#workers].filter((worker) => !worker.busy);
    const worker = idleWorkers.find(
      ({ name: workerName }) => workerName === name
    );
    if (worker) {
      return worker;
    }

    if (this.#workers.size < this.#concurrency) {
      const runnerClass = this.#runnerFactories.get(name);
      if (!runnerClass) {
        throw new Error(`No runner is named ${name}.`);
      }

      const workerInstance = new Worker<TPayload, TResult>(
        new runnerClass(),
        runnerClass.name
      );

      this.#workers.add(workerInstance);

      return workerInstance;
    } else {
      // Discard idle workers of other types, if available.
      const idleWorker = idleWorkers.find(
        ({ name: workerName }) => workerName !== name
      );

      if (idleWorker) {
        this.#workers.delete(idleWorker);

        // Hint: To increase concurrency, to not await in runners.
        await idleWorker.dispose();

        return this.#getWorker(name);
      }
    }
  }
}

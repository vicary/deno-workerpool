import { Class, JsonValue, Promisable, SetOptional } from "type-fest";
import { Executable } from "./Executable.ts";
import { Runner, RunnerExecutionError } from "./Runner.ts";
import { Task } from "./Task.ts";

export type WorkerpoolOptions<TPayload = JsonValue, TResult = unknown> = {
  /**
   * Worker classes implementing the Executable interface.
   */
  workers: Class<Executable<TPayload, TResult>>[];

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
  maximumTaskPerRunner?: number;

  /**
   * Implementation of task enqueuing.
   *
   * Retries will also call this method with the task object, this function
   * should reset the mutex lock if available.
   */
  enqueue: (task: Task<TPayload>) => Promisable<void>;

  /**
   * Retrieves the next pending task, this function should acquire mutex lock
   * for the task.
   */
  dequeue: () => Promisable<Task<TPayload> | undefined>;

  /**
   * Called when a dequeued task is successful, use this function to remove
   * finished tasks (mutex).
   */
  success?: (task: Task<TPayload>, result: TResult) => Promisable<void>;

  /**
   * Called when a failing task has exceeded maximum retries.
   */
  failure?: (task: Task<TPayload>, error: Error) => Promisable<void>;
};

export class Workerpool<TPayload = JsonValue, TResult = unknown> {
  #active = false;
  #dequeueActive = false;
  #concurrency = 10;
  #maximumRetries = 0;
  #maximumTaskPerRunner = Infinity;
  #runnerFactories = new Map<string, Class<Executable<TPayload, TResult>>>();
  #runners = new Set<Runner<TPayload, TResult>>();

  constructor(readonly options: WorkerpoolOptions<TPayload, TResult>) {
    options.workers?.forEach((worker) => {
      this.#runnerFactories.set(worker.name, worker);
    });

    if (options.concurrency) {
      this.#concurrency = options.concurrency;
    }

    if (options.maximumRetries) {
      this.#maximumRetries = options.maximumRetries;
    }

    if (options.maximumTaskPerRunner) {
      this.#maximumTaskPerRunner = options.maximumTaskPerRunner;
    }
  }

  get concurrency() {
    return this.#runners.size;
  }

  start() {
    if (this.#active) {
      return;
    }

    this.#active = true;
    this.#startDequeue();

    return this;
  }

  pause() {
    this.#active = false;

    // Trigger runner disposal if the queue is already empty.
    this.#startDequeue();
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
  }: SetOptional<Task<TPayload>, "executionCount">) {
    const doEnqueue = async () => {
      await this.options.enqueue({ executionCount, ...task });

      // Don't await for task executions here.
      if (this.#active && this.#runners.size === 0) {
        this.#startDequeue();
      }
    };

    doEnqueue();

    return this;
  }

  async #startDequeue() {
    if (!this.#active) {
      return await this.#disposeIdleRunners();
    }

    // The idea is to maintain one and only one active dequeuing chain at a time.
    if (this.#dequeueActive) {
      return;
    }

    this.#dequeueActive = true;
    return await this.#dequeue();
  }

  async #dequeue() {
    if (!this.#active) {
      this.#dequeueActive = false;
      return await this.#disposeIdleRunners();
    }

    const task = await this.options.dequeue();
    // No tasks available, mark inactive and wait for next enqueue.
    if (!task) {
      this.#dequeueActive = false;
      return await this.#disposeIdleRunners();
    }

    const runner = this.#getRunner(task.name);
    // No runners available yet, wait for the next dequeue.
    if (!runner) {
      return await this.options.enqueue(task);
    }

    task.executionCount++;

    runner
      .execute(task.payload)
      .then(
        (result) => this.options.success?.(task, result),
        (error) => {
          if (
            error instanceof RunnerExecutionError &&
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
        if (runner.executionCount >= this.#maximumTaskPerRunner) {
          this.#runners.delete(runner);
        }

        this.#dequeue();
      });

    this.#dequeue();
  }

  async #disposeIdleRunners() {
    // Release idle runners
    const idleRunners = [...this.#runners].filter((runner) => !runner.busy);

    await Promise.all(idleRunners.map((runner) => runner.dispose()));

    for (const runner of idleRunners) {
      this.#runners.delete(runner);
    }
  }

  #getRunner(name: string): Runner<TPayload, TResult> | undefined {
    const idleRunners = [...this.#runners].filter((runner) => !runner.busy);
    const runner = idleRunners.find(
      ({ name: runnerName }) => runnerName === name
    );
    if (runner) {
      return runner;
    }

    if (this.#runners.size < this.#concurrency) {
      const executableClass = this.#runnerFactories.get(name);
      if (!executableClass) {
        throw new Error(`No executable is named ${name}.`);
      }

      const runnerInstance = new Runner<TPayload, TResult>(
        new executableClass(),
        executableClass.name
      );

      this.#runners.add(runnerInstance);

      return runnerInstance;
    } else {
      // Discard idle runners of other types, if available.
      const idleRunner = idleRunners.find(
        ({ name: runnerName }) => runnerName !== name
      );

      if (idleRunner) {
        this.#runners.delete(idleRunner);

        idleRunner.dispose();

        return this.#getRunner(name);
      }
    }
  }
}

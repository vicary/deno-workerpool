import type { Class, JsonValue, Promisable, SetOptional } from "./deps.ts";
import type { Executable } from "./Executable.ts";
import { Runner, RunnerExecutionError } from "./Runner.ts";
import type { Task } from "./Task.ts";

type CallbackContext<TPayload = JsonValue, TResult = unknown> = {
  task: Task<TPayload>;
  runner: Runner<TPayload, TResult>;
};

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
   * Callback style task handler.
   */
  onTaskFinished?: {
    (
      error: Error,
      result: null,
      context: CallbackContext<TPayload, TResult>,
    ): Promisable<void>;
    (
      error: null,
      result: TResult,
      context: CallbackContext<TPayload, TResult>,
    ): Promisable<void>;
  };

  /**
   * Called when the state of the pool is changed.
   */
  onStateChange?: (state: WorkerpoolState) => Promisable<void>;
};

/**
 * 1. **running:** Workerpool becomes active via .start() or .enqueue().
 * 2. **draining:** Workerpool is paused via .pause().
 * 3. **drained:** All active runners are disposed via task exhaustion or pausing.
 */
export type WorkerpoolState = "running" | "draining" | "drained";

export class Workerpool<TPayload = JsonValue, TResult = unknown> {
  #active = false;
  #state: WorkerpoolState = "drained";
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

  get paused() {
    return !this.#active;
  }

  get state() {
    return this.#state;
  }

  set state(value: WorkerpoolState) {
    if (this.#state === value) return;

    this.#state = value;
    this.options.onStateChange?.bind(this)(value);
  }

  start() {
    if (this.#active) {
      return this;
    }

    this.#active = true;
    this.state = "running";
    this.#startDequeue();

    return this;
  }

  /**
   * Pause further task execution.
   *
   * Workerpool will start draining idle runners, and fires the drained()
   * callback when all runners currently active are disposed.
   */
  pause(): Promisable<void> {
    if (!this.#active) return;

    this.#active = false;
    this.state = "draining";

    // Drain immediately if queue is already empty.
    return this.#disposeIdleRunners();
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

      // Restart dequeue if we still have concurrent capacity.
      if (
        this.#active &&
        (this.#runners.size < this.#concurrency ||
          [...this.#runners].some(({ busy }) => !busy))
      ) {
        this.#startDequeue();
      }
    };

    doEnqueue();

    return this;
  }

  async #startDequeue() {
    // The idea is to maintain one and only one active dequeuing chain at a time.
    if (this.#dequeueActive) return;

    this.#dequeueActive = true;
    this.state = "running";
    return await this.#dequeue();
  }

  async #dequeue(): Promise<void> {
    if (!this.#active) {
      this.#dequeueActive = false;

      if (this.#state === "draining") {
        return await this.#disposeIdleRunners();
      } else {
        return;
      }
    }

    const task = await this.options.dequeue();
    // No tasks available, mark inactive and wait for next enqueue.
    if (!task) {
      this.#dequeueActive = false;

      // Set drained if all runners are already idle.
      if ([...this.#runners].every(({ busy }) => !busy)) {
        this.state = "drained";
      }

      return;
    }

    const runner = this.#getRunner(task.name);
    // No runners available yet, put the task back and wait.
    if (!runner) {
      return await this.options.enqueue(task);
    }

    task.executionCount++;

    runner
      .execute(task.payload)
      .then(
        (result) =>
          this.options.onTaskFinished?.(null, result, { task, runner }),
        (error) => {
          if (
            error instanceof RunnerExecutionError &&
            error.retryable &&
            task.executionCount < this.#maximumRetries
          ) {
            this.enqueue(task);
          } else if (this.options.onTaskFinished) {
            return this.options.onTaskFinished(error, null, { task, runner });
          } else {
            throw error;
          }
        },
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

    for (const runner of idleRunners) {
      this.#runners.delete(runner);
    }

    await Promise.all(idleRunners.map((runner) => runner.dispose()));

    if (this.#runners.size === 0) {
      this.state = "drained";
    }
  }

  #getRunner(name: string): Runner<TPayload, TResult> | undefined {
    const idleRunners = [...this.#runners].filter((runner) => !runner.busy);
    const runner = idleRunners.find(
      ({ name: runnerName }) => runnerName === name,
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
        executableClass.name,
      );

      this.#runners.add(runnerInstance);

      return runnerInstance;
    } else {
      // Discard idle runners of other types, if available.
      const idleRunner = idleRunners.find(
        ({ name: runnerName }) => runnerName !== name,
      );

      if (idleRunner) {
        this.#runners.delete(idleRunner);

        idleRunner.dispose();

        return this.#getRunner(name);
      }
    }
  }
}

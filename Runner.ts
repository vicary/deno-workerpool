import { Executable } from "./Executable.ts";

export class RunnerExecutionError extends Error {
  constructor(
    message: string,
    readonly name: string,
    readonly retryable = false
  ) {
    super(message);
  }
}

/**
 * A wrapper class for task runners.
 */
export class Runner<TPayload = unknown, TResult = unknown> {
  #executionnCount = 0;
  #successCount = 0;
  #failureCount = 0;

  #busy = false;

  constructor(
    readonly runner: Executable<TPayload, TResult>,
    readonly name: string
  ) {}

  get busy() {
    return this.#busy;
  }

  get executionCount() {
    return this.#executionnCount;
  }

  get successCount() {
    return this.#successCount;
  }

  get failureCount() {
    return this.#failureCount;
  }

  async execute(payload: TPayload): Promise<TResult> {
    if (this.#busy) {
      throw new Error(`Runner ${this.name} is busy.`);
    }

    this.#busy = true;

    try {
      const result = await this.runner.execute(payload);

      this.#successCount++;

      await this.runner.onSuccess?.(result);

      return result;
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }

      this.#failureCount++;

      const retryable = await this.runner.onFailure?.(error);

      throw new RunnerExecutionError(
        error.message,
        error.name,
        retryable ?? true
      );
    } finally {
      this.#executionnCount++;
      this.#busy = false;
    }
  }

  dispose() {
    return this.runner.dispose?.();
  }
}

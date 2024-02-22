import { comlink, type Promisable } from "./deps.ts";

/**
 * The Runner interface.
 */
export interface Executable<TPayload, TResult, TError extends Error = Error> {
  execute: (payload: TPayload) => Promisable<TResult>;

  onSuccess?: (result: TResult) => Promisable<void>;

  /**
   * Called when execute throws an error.
   *
   * This function may return a boolean to indicate if the task can be retried,
   * defaults to true and always retries.
   */
  onFailure?: (error: TError) => Promisable<boolean | void>;

  /**
   * Optional cleanup method to be called when the runner is about to be dropped
   * due to concurrency overload, e.g. Workers#terminate() or DataSource#destroy().
   */
  dispose?: () => Promisable<void>;
}

export const initializeWorker = <
  T extends // deno-lint-ignore no-explicit-any
  Executable<any, any>,
>(
  callbacks: T,
) => {
  if (!(self instanceof WorkerGlobalScope)) {
    throw new Error("This module is only intended to be used in a worker.");
  }

  comlink.expose(callbacks);
};

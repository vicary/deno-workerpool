import {
  comlink,
  type Promisable,
  type Remote,
  type UnproxyOrClone,
} from "./deps.ts";
import { type Executable } from "./Executable.ts";

/**
 * A Web Worker implementation in a `workerpool` compatible format, uses
 * `comlink` under the hood.
 *
 * **Note:** Target worker script must expose an object compatiable with the `Executable`
 * interface.
 */
export class ExecutableWorker<
  TPayload = unknown,
  TResult = unknown,
  TError extends Error = Error,
> implements Executable<TPayload, TResult, TError> {
  #worker: Worker;
  #linked: Remote<Executable<TPayload, TResult>>;

  constructor(uri: string, options?: Omit<WorkerOptions, "type">) {
    this.#worker = new Worker(uri, { ...options, type: "module" });
    this.#linked = comlink.wrap<Executable<TPayload, TResult>>(this.#worker);
  }

  execute(payload: TPayload) {
    const result = this.#linked.execute(payload as UnproxyOrClone<TPayload>);

    return result as Promisable<TResult>;
  }

  async onSuccess(result: TResult) {
    const onSuccess = await this.#linked.onSuccess;
    return onSuccess?.(result as UnproxyOrClone<TResult>);
  }

  async onFailure(error: Error) {
    const onFailure = await this.#linked.onFailure;
    return onFailure?.(error);
  }

  async dispose() {
    await this.#linked[comlink.releaseProxy]();
    this.#worker.terminate();
  }
}

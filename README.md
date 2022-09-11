# Workerpool

An unopinionated small scale worker pool abstraction which serves as a base interface for more advanced worker managers.

**Note:** This is NOT a drop-in replacement of the NPM `workerpool`, but it's easy to create the same functionality (see _Web Workers_ section below).

**Note:** This is not yet a good candidate for large scale distributed queues, cluster awareness such as mutex and event ack have to be in place before that. If you think solutions in such a scale is viable in Deno, consider [buy me a coffee](https://buymeacoffee.com/vicary) and I'll make it happen.

## Terminology

1. **Workerpool**

   A manager that creates workers on the fly, executing tasks up to defined
   concurrency.

2. **Workers**

   Workers\* are internal wrappers for user provided runner classes, they maintain internal states such as active/busy and the retry counter.

   _\* Not to be confused with Web Workers._

3. **Runners**

   User implementation of task executors, where they all implements the `Runner`
   interface.

4. **Tasks**

   Tasks are named payloads enqueued into a workerpool.

## Basic Usage

```ts
class RunnerA implements Runner {...}
class RunnerB implements Runner {...}

const pool = new Workerpool({
  concurrency: 2,
  runners: [RunnerA, RunnerB]
});

pool
  .enqueue({ name: "RunnerA", payload: {...} })
  .enqueue({ name: "RunnerB", payload: {...} })
  .start();
```

## Runner Examples

### In-memory Queue

As a proof of concept, this is the most basic implementation of an in-memory queue.

```ts
type Payload = any;

type MemoryMutexTask = RunnerTask<Payload> & { active?: boolean };

const tasks: MemoryMutexTask[] = [];

const pool = new Workerpool<Payload>({
  concurrency: 1,
  runners: [runnerA, runnerB],
  enqueue: (task: MemoryMutexTask) => {
    if (tasks.includes(task)) {
      task.active = false;
    } else {
      tasks.push(task);
    }
  },
  dequeue: () => {
    // Uncomment the following line for FIFO queues
    // if (tasks.find(({ active }) => active)) return;

    const task = tasks.find(({ active }) => !active);
    if (task) {
      task.active = true;
      return task;
    }
  },
  success: (task) => {
    const index = tasks.indexOf(task);
    if (index > -1) {
      tasks.splice(index, 1);
    }
  },
});
```

### Web Workers

Deno has built-in support for workers, I'll use `comlink` to reduce codebase for simplicity.

You'll need a separated script file for the worker.

```ts
// myworker.ts
import { expose } from "https://cdn.skypack.dev/comlink?dts";

expose({
  execute: async (payload: string) => {
    // Simulate async actions
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return `Worker echo: ${payload}`;
  },
});
```

And a proxy class in your main thread.

```ts
// myrunner.ts
import {
  Remote,
  UnproxyOrClone,
  wrap,
} from "https://cdn.skypack.dev/comlink?dts";
import type { Runner } from "https://deno.land/x/workerpool/mod.ts";

export class MyRunner<TPayload = string, TResult = string>
  implements Runner<TPayload, TResult>
{
  #worker: Remote<Worker & Runner<TPayload, TResult>>;

  constructor() {
    const worker = new Worker(new URL("./myworker.ts", import.meta.url).href, {
      type: "module",
    });

    this.#worker = wrap<Worker & Runner<TPayload, TResult>>(worker);
  }

  execute(payload: TPayload) {
    const result = this.#worker.execute(payload as UnproxyOrClone<TPayload>);

    return result as Promisable<TResult>;
  }

  async onSuccess(result: TResult) {
    const onSuccess = await this.#worker.onSuccess;
    return onSuccess?.(result as UnproxyOrClone<TResult>);
  }

  async onFailure(error: Error) {
    const onFailure = await this.#worker.onFailure;
    return onFailure?.(error);
  }

  dispose() {
    return this.#worker.terminate();
  }
}
```

Now register the runners into the workerpool:

```ts
const pool = new Workerpool({
  concurrency: 1,
  runners: [MyRunner],
});

pool
  .enqueue({ name: "MyRunner", payload: "Hello World!" })
  .enqueue({ name: "MyRunner", payload: "Hello Again!" })
  .start();
```

# Workerpool

An unopinionated small scale worker pool abstraction which serves as a base interface for more advanced worker managers.

**Note:** This is NOT a drop-in replacement of the NPM `workerpool`, but it's easy to create the same functionality (see _Web Workers_ section below).

**Note:** This is not yet a good candidate for large scale distributed queues, cluster awareness such as mutex and event ack have to be in place before that. If you think solutions in such a scale is viable in Deno, consider [buy me a coffee](https://buymeacoffee.com/vicary) and I'll make it happen.

## Terminology

1. **Workerpool**

   A manager that creates workers on the fly, executing tasks up to defined concurrency.

2. **Runner**

   Runners are internal wrappers for user provided runner classes, they maintain internal states such as active/busy and the retry counter.

3. **Executable**

   User implementation of task executors, where they all implements the `Executable` interface.

   Also called _workers_ for the sake of naming convension, but the usage kept minimal to avoid confusion with Web Workers.

4. **Task**

   Tasks are named payloads enqueued into a workerpool.

## Basic Usage

```ts
import { Executable, Workerpool } from "https://deno.land/x/workerpool/mod.ts";

class FooWorker implements Executable {...}
class BarWorker implements Executable {...}

const pool = new Workerpool({
  concurrency: 2,
  workers: [FooWorker, BarWorker]
});

pool
  .enqueue({ name: "FooWorker", payload: {...} })
  .enqueue({ name: "BarWorker", payload: {...} })
  .start();
```

## Runner Examples

### In-memory Queue

As a proof of concept, this is the most basic implementation of an in-memory queue.

```ts
type Payload = any;

type MemoryMutexTask = Task<Payload> & { active?: boolean };

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

Deno has built-in support for workers, our `ExecutableWorker` class serves as a simple proxy class via `comlink`.

You'll need a separated script file for the worker.

```ts
// worker.ts
import { expose } from "https://cdn.skypack.dev/comlink?dts";

expose({
  execute: async (payload: string) => {
    // Simulate async actions
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return `Worker echo: ${payload}`;
  },
});
```

Now register the runners into the workerpool:

```ts
import { ExecutableWorker } from "https://deno.land/x/workerpool/mod.ts";

class MyWorker extends ExecutableWorker<string, void> {
  constructor() {
    super(new URL("./worker.ts", import.meta.url).href);
  }
}

const pool = new Workerpool({
  concurrency: 1,
  workers: [MyWorker],
});

pool
  .enqueue({ name: "MyWorker", payload: "Hello World!" })
  .enqueue({ name: "MyWorker", payload: "Hello Again!" })
  .start();
```

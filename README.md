# Workerpool

An unopinionated small scale worker pool abstraction which serves as a base interface for more advanced worker managers.

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

class RunnerA implements Executable {...}
class RunnerB implements Executable {...}

const pool = new Workerpool({
  concurrency: 2,
  workers: [RunnerA, RunnerB]
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
type MemoryMutexTask = Task<Payload> & { active?: boolean };

const tasks = new Set<MemoryMutexTask>();
const pool = new Workerpool<Payload>({
  concurrency: 1,
  runners: [runnerA, runnerB],
  enqueue(task: MemoryMutexTask) {
    task.active = false;
    tasks.add(task);
  },
  dequeue() {
    // Uncomment the following line for FIFO queues
    // if ([...tasks].some(({ active }) => active)) return;

    for (const task of tasks) {
      if (!task.active) {
        task.busy = true;
        return task;
      }
    }
  },
  onTaskFinish(error, result, { task }) {
    tasks.delete(task);

    if (error) {
      console.error(error);
    } else {
      console.log(result);
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

class MyRunner extends ExecutableWorker<string, void> {
  constructor() {
    super(new URL("./worker.ts", import.meta.url).href);
  }
}

const pool = new Workerpool({
  concurrency: 1,
  workers: [MyRunner],
});

pool
  .enqueue({ name: "MyRunner", payload: "Hello World!" })
  .enqueue({ name: "MyRunner", payload: "Hello Again!" })
  .start();
```

## Sponsorship

If you appreciate my work, or want to see specific features to happen, [a coffee would do](https://buymeacoffee.com/vicary).

import { proxy } from "comlink";
import { assertEquals } from "https://deno.land/std@0.155.0/testing/asserts.ts";
import { describe, it } from "https://deno.land/std@0.155.0/testing/bdd.ts";
import {
  assertSpyCalls,
  spy,
} from "https://deno.land/std@0.155.0/testing/mock.ts";
import { Class, SetOptional } from "type-fest";
import { Executable } from "./Executable.ts";
import { ExecutableWorker } from "./ExecutableWorker.ts";
import { Task } from "./Task.ts";
import { Workerpool } from "./Workerpool.ts";

export type ArrowFunction = (...args: unknown[]) => unknown;
type MemoryMutexTask<TPayload> = Task<TPayload> & { active?: boolean };
type PreparePoolOptions<TPayload, TResult> = {
  concurrency: number;
  tasks: SetOptional<Task<TPayload>, "executionCount">[];
  workers: Class<Executable<TPayload, TResult>>[];
};

describe("Workerpool", () => {
  // In-memory FIFO awaiable queue.
  const createMockQueue = async <TPayload, TResult = unknown>({
    concurrency,
    tasks,
    workers,
  }: PreparePoolOptions<TPayload, TResult>) =>
    await new Promise<Workerpool<TPayload, TResult>>((resolve) => {
      const queue: MemoryMutexTask<TPayload>[] = [];
      const pool = new Workerpool<TPayload, TResult>({
        concurrency,
        workers,
        enqueue: (task: MemoryMutexTask<TPayload>) => {
          if (queue.includes(task)) {
            task.active = false;
          } else {
            queue.push(task);
          }
        },
        dequeue: () => {
          const task = queue.find(({ active }) => !active);
          if (task) {
            task.active = true;
            return task;
          }
        },
        onTaskFinished: (_error, _result, { task }) => {
          const index = queue.indexOf(task);
          if (index > -1) {
            queue.splice(index, 1);
          }
        },
        onStateChange: (state) => {
          if (state !== "drained") return;

          if (queue.length > 0) {
            throw new Error(`Drained with ${queue.length} tasks remaining.`);
          }

          resolve(pool);
        },
      });

      for (const task of tasks) {
        pool.enqueue(task);
      }

      pool.start();
    });

  class workerA implements Executable<ArrowFunction, void> {
    async execute(cb?: ArrowFunction) {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 200));
      cb?.();
    }
  }

  it("should process all tasks", async () => {
    const callback = spy(() => {});
    await createMockQueue({
      concurrency: 2,
      workers: [workerA],
      tasks: [
        { name: "workerA", payload: callback },
        { name: "workerA", payload: callback },
        { name: "workerA", payload: callback },
        { name: "workerA", payload: callback },
      ],
    });

    assertSpyCalls(callback, 4);
  });

  it("should swap workers when concurrency is reached", async () => {
    class workerB extends workerA {}

    const callback = spy(() => {});
    await createMockQueue({
      concurrency: 1,
      workers: [workerA, workerB],
      tasks: [
        { name: "workerA", payload: callback },
        { name: "workerB", payload: callback },
        { name: "workerA", payload: callback },
        { name: "workerB", payload: callback },
      ],
    });

    assertSpyCalls(callback, 4);
  });

  // Temporarily ignored, see https://github.com/GoogleChromeLabs/comlink/issues/598
  it.ignore("should support web workers", async () => {
    let counter = 0;
    const callback = proxy(() => {
      counter++;
    });

    class workerC extends ExecutableWorker<ArrowFunction> {
      constructor() {
        super(new URL("./__test__/example-worker.ts", import.meta.url).href);
      }
    }

    const pool = await createMockQueue({
      concurrency: 2,
      workers: [workerC],
      tasks: [
        { name: "workerC", payload: callback },
        { name: "workerC", payload: callback },
        { name: "workerC", payload: callback },
        { name: "workerC", payload: callback },
      ],
    });

    pool.pause();

    assertEquals(counter, 2);
  });
});

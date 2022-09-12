import { proxy } from "https://cdn.skypack.dev/comlink?dts";
import { assertEquals } from "https://deno.land/std@0.155.0/testing/asserts.ts";
import { describe, it } from "https://deno.land/std@0.155.0/testing/bdd.ts";
import {
  assertSpyCalls,
  stub,
} from "https://deno.land/std@0.155.0/testing/mock.ts";
import { Class, SetOptional } from "type-fest";
import { Executable } from "./Executable.ts";
import { ExecutableWorker } from "./ExecutableWorker.ts";
import { Task } from "./Task.ts";
import { Workerpool, WorkerpoolOptions } from "./Workerpool.ts";

export type ArrowFunction = (...args: unknown[]) => unknown;
type MemoryMutexTask<TPayload> = Task<TPayload> & { active?: boolean };
type PreparePoolOptions<TPayload, TResult> = {
  concurrency: number;
  success?: WorkerpoolOptions<TPayload, TResult>["success"];
  tasks: SetOptional<Task<TPayload>, "executionCount">[];
  workers: Class<Executable<TPayload, TResult>>[];
};

describe("Workerpool", () => {
  // In-memory FIFO awaiable queue.
  const createMockQueue = async <TPayload, TResult = unknown>({
    concurrency,
    success,
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
        success: (task, result) => {
          const index = queue.indexOf(task);
          if (index > -1) {
            queue.splice(index, 1);
          }

          success?.(task, result);

          if (queue.length === 0) {
            resolve(pool);
          }
        },
      });

      tasks.forEach((task) => pool.enqueue(task));

      pool.start();
    });

  class workerA implements Executable<ArrowFunction, void> {
    async execute(cb?: ArrowFunction) {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 200));
      cb?.();
    }
  }

  it("should process all tasks", async () => {
    const callback = stub({ callback: () => {} }, "callback");
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

    const callback = stub({ callback: () => {} }, "callback");
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

      pool
        .enqueue({ name: "runnerA", payload: callback })
        .enqueue({ name: "runnerB", payload: callback })
        .enqueue({ name: "runnerA", payload: callback })
        .enqueue({ name: "runnerB", payload: callback })
        .start();
    });

    assertSpyCalls(callback, 4);
    assertEquals(tasks.length, 0);
  });

  it("should work with workers", async () => {
    // TODO:
  });
});

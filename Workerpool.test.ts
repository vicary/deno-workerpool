import { assertEquals } from "https://deno.land/std@0.155.0/testing/asserts.ts";
import { describe, it } from "https://deno.land/std@0.155.0/testing/bdd.ts";
import {
  assertSpyCalls,
  stub,
} from "https://deno.land/std@0.155.0/testing/mock.ts";
import { Runner } from "./Runner.ts";
import { RunnerTask } from "./RunnerTask.ts";
import { Workerpool } from "./Workerpool.ts";

type ArrowFunction = (...args: unknown[]) => unknown;
type MemoryMutexTask = RunnerTask<ArrowFunction> & { active?: boolean };

describe("Workerpool", () => {
  class runnerA implements Runner<ArrowFunction, void> {
    async execute(cb?: ArrowFunction) {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 200));
      cb?.();
    }
  }

  class runnerB extends runnerA {}

  it("should process all tasks", async () => {
    const { callback, tasks } = await new Promise((resolve) => {
      const tasks: MemoryMutexTask[] = [];
      const callback = stub({ callback: () => {} }, "callback");
      const pool = new Workerpool<ArrowFunction>({
        concurrency: 2,
        runners: [runnerA],
        enqueue: (task: MemoryMutexTask) => {
          if (tasks.includes(task)) {
            task.active = false;
          } else {
            tasks.push(task);
          }
        },
        dequeue: () => {
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

          if (tasks.length === 0) {
            resolve({ callback, tasks });
          }
        },
      });

      pool
        .enqueue({ name: "runnerA", payload: callback })
        .enqueue({ name: "runnerA", payload: callback })
        .enqueue({ name: "runnerA", payload: callback })
        .enqueue({ name: "runnerA", payload: callback })
        .start();
    });

    assertSpyCalls(callback, 4);
    assertEquals(tasks.length, 0);
  });

  it("should swap workers when concurrency is reached", async () => {
    const { callback, tasks } = await new Promise((resolve) => {
      const tasks: MemoryMutexTask[] = [];
      const callback = stub({ callback: () => {} }, "callback");
      const pool = new Workerpool<ArrowFunction>({
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

          if (tasks.length === 0) {
            resolve({ callback, tasks });
          }
        },
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

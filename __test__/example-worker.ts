/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { expose } from "comlink";
import type { Executable } from "../Executable.ts";
import { ArrowFunction } from "../Workerpool.test.ts";

const exposedObject: Executable<ArrowFunction> = {
  async execute(payload) {
    // Mimic async action.
    await new Promise((resolve) => setTimeout(resolve, 100));

    return await payload();
  },
};

expose(exposedObject);

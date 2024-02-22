/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { comlink } from "../deps.ts";
import { type Executable } from "../Executable.ts";
import { type ArrowFunction } from "../Workerpool.test.ts";

const exposedObject: Executable<ArrowFunction, unknown> = {
  async execute(payload) {
    // Mimic async action.
    await new Promise((resolve) => setTimeout(resolve, 100));

    return await payload();
  },
};

comlink.expose(exposedObject);

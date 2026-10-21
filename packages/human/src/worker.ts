/**
 * Web Worker entry: evaluates human shapes off the main thread.
 * With Vite: `import HumanWorker from "@actors/human/worker?worker"` and
 * `human.useWorker(new HumanWorker())`.
 */
import { type MessagePortLike, serveRuntime } from "@actors/core";
import { ROBOT_TASK, robotTask } from "./robot";

serveRuntime(self as unknown as MessagePortLike, { [ROBOT_TASK]: robotTask });

/**
 * Web Worker entry: evaluates animal shapes off the main thread.
 * With Vite: `import AnimalWorker from "@actors/animal/worker?worker"` and
 * `animal.useWorker(new AnimalWorker())`.
 */
import { type MessagePortLike, serveRuntime } from "@actors/core";

serveRuntime(self as unknown as MessagePortLike);

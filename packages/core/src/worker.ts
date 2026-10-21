/**
 * Runs shape evaluation off the main thread. Engine-agnostic: works with any
 * object with postMessage and addEventListener("message") (a browser Web Worker, a worker_threads
 * port with a small wrapper, ...).
 *
 * Worker side:   serveRuntime(self)
 * Main side:     const remote = await RemoteRuntime.connect(worker, manifestUrl)
 *                const shape = await remote.evaluate(weights)
 */
import { ActorRuntime, type ActorShape } from "./runtime";
import type { ShapeOptions } from "./deform";

export interface MessagePortLike {
  postMessage(message: unknown, transfer?: unknown[]): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

type Request =
  | { id: number; type: "load"; url: string }
  | { id: number; type: "evaluate"; weights: [string, number][]; options?: ShapeOptions; task?: { name: string; args: unknown } }
  | { id: number; type: "loadMeshes"; names: string[] };

type Response = { id: number; ok: true; shape?: ActorShape; task?: unknown } | { id: number; ok: false; error: string };

/**
 * Extra work a worker can do on each new shape before handing it over (e.g.
 * building robot parts from it), so the main thread gets both at once.
 * Returns the result and the buffers to transfer with it.
 */
export type ShapeTask = (runtime: ActorRuntime, shape: ActorShape, args: unknown) => { result: unknown; transfer?: ArrayBuffer[] };

function shapeBuffers(shape: ActorShape): ArrayBuffer[] {
  const out: ArrayBuffer[] = [shape.positions.buffer as ArrayBuffer, shape.normals.buffer as ArrayBuffer];
  for (const m of [...shape.proxies.values(), ...shape.meshes.values()]) out.push(m.positions.buffer as ArrayBuffer, m.normals.buffer as ArrayBuffer);
  return out;
}

/** Call inside the worker. `tasks`: shape tasks the main thread can ask for by name (see `RemoteRuntime.evaluateWith`). */
export function serveRuntime(port: MessagePortLike, tasks: Record<string, ShapeTask> = {}): void {
  let runtime: ActorRuntime | undefined;
  // Evaluations run one at a time, in order.
  let queue = Promise.resolve();
  port.addEventListener("message", ({ data }) => {
    const req = data as Request;
    queue = queue.then(async () => {
      try {
        if (req.type === "load") {
          runtime = await ActorRuntime.load(req.url);
          port.postMessage({ id: req.id, ok: true } satisfies Response);
        } else if (req.type === "loadMeshes") {
          if (!runtime) throw new Error("No actor pack loaded");
          await runtime.loadMeshes(req.names);
          port.postMessage({ id: req.id, ok: true } satisfies Response);
        } else {
          if (!runtime) throw new Error("No actor pack loaded");
          // Fresh buffers every time: they are transferred (moved) to the main thread.
          const shape = await runtime.evaluate(new Map(req.weights), undefined, req.options);
          const fn = req.task ? tasks[req.task.name] : undefined;
          if (req.task && !fn) throw new Error(`Unknown shape task ${req.task.name}`);
          const task = fn?.(runtime, shape, req.task!.args);
          port.postMessage({ id: req.id, ok: true, shape, task: task?.result } satisfies Response, [...shapeBuffers(shape), ...(task?.transfer ?? [])]);
        }
      } catch (e) {
        port.postMessage({ id: req.id, ok: false, error: (e as Error).message ?? String(e) } satisfies Response);
      }
    });
  });
}

/** Main-thread handle to a runtime living in a worker. */
export class RemoteRuntime {
  private next = 1;
  private readonly waiting = new Map<number, { resolve: (r: Response) => void }>();

  private constructor(private readonly port: MessagePortLike) {
    port.addEventListener("message", ({ data }) => {
      const res = data as Response;
      this.waiting.get(res.id)?.resolve(res);
      this.waiting.delete(res.id);
    });
  }

  private call(req: Omit<Request, "id"> & { type: Request["type"] }): Promise<Response> {
    const id = this.next++;
    return new Promise<Response>((resolve) => {
      this.waiting.set(id, { resolve });
      this.port.postMessage({ ...req, id });
    }).then((res) => {
      if (!res.ok) throw new Error(res.error);
      return res;
    });
  }

  /** `manifestUrl` must be absolute (the worker resolves relative URLs against its own script). */
  static async connect(port: MessagePortLike, manifestUrl: string): Promise<RemoteRuntime> {
    const remote = new RemoteRuntime(port);
    await remote.call({ type: "load", url: manifestUrl } as Request);
    return remote;
  }

  /** Loads on-demand meshes in the worker too, so its shapes include their proxies (see ActorRuntime.loadMeshes). */
  async loadMeshes(names: string[]): Promise<void> {
    await this.call({ type: "loadMeshes", names } as Request);
  }

  async evaluate(weights: Map<string, number>, options?: ShapeOptions): Promise<ActorShape> {
    const res = await this.call({ type: "evaluate", weights: [...weights], options } as Request);
    return (res as { shape: ActorShape }).shape;
  }

  /** Evaluates a shape and runs a shape task (registered with `serveRuntime`) on it in the worker. */
  async evaluateWith<T>(weights: Map<string, number>, options: ShapeOptions | undefined, task: { name: string; args: unknown }): Promise<{ shape: ActorShape; task: T }> {
    const res = (await this.call({ type: "evaluate", weights: [...weights], options, task } as Request)) as { shape: ActorShape; task: T };
    return { shape: res.shape, task: res.task };
  }
}
